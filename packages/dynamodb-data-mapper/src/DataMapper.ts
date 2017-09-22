import DynamoDB = require('aws-sdk/clients/dynamodb');
import {OnMissingStrategy, ReadConsistency} from "./constants";
import {ItemNotFoundException} from "./ItemNotFoundException";
import {
    DataMapperConfiguration,
    DataMapperParameters,
    DeleteParameters,
    GetParameters,
    PutParameters,
    QueryParameters,
    ScanParameters,
    UpdateParameters,
} from './namedParameters';
import {
    marshallItem,
    marshallValue,
    Schema,
    SchemaType,
    unmarshallItem,
} from "@aws/dynamodb-data-marshaller";
import {
    AttributePath,
    AttributeValue,
    ConditionExpression,
    ConditionExpressionPredicate,
    ExpressionAttributes,
    FunctionExpression,
    isConditionExpression,
    isConditionExpressionPredicate,
    MathematicalExpression,
    serializeConditionExpression,
    serializeProjectionExpression,
    UpdateExpression,
} from "@aws/dynamodb-expressions";
import {
    DeleteItemInput,
    GetItemInput,
    PutItemInput,
    QueryInput,
    QueryOutput,
    ScanInput,
    ScanOutput,
    UpdateItemInput,
} from "aws-sdk/clients/dynamodb";
require('./asyncIteratorSymbolPolyfill');

export type StringToAnyObjectMap = {[key: string]: any};

export class DataMapper {
    private readonly client: DynamoDB;
    private readonly readConsistency: ReadConsistency;
    private readonly skipVersionCheck: boolean;
    private readonly tableNamePrefix: string;

    constructor({
        client,
        readConsistency = ReadConsistency.EventuallyConsistent,
        skipVersionCheck = false,
        tableNamePrefix = ''
    }: DataMapperConfiguration) {
        this.client = client;
        this.readConsistency = readConsistency;
        this.skipVersionCheck = skipVersionCheck;
        this.tableNamePrefix = tableNamePrefix;
    }

    async delete<T extends StringToAnyObjectMap = StringToAnyObjectMap>({
        condition,
        item,
        tableDefinition: {tableName, schema},
        returnValues = 'ALL_OLD',
        skipVersionCheck = this.skipVersionCheck,
    }: DeleteParameters<T> & DataMapperParameters): Promise<T|undefined> {
        const operationInput: DeleteItemInput = {
            TableName: this.tableNamePrefix + tableName,
            Key: {},
            ReturnValues: returnValues,
        };

        for (const prop of Object.keys(schema)) {
            let inputMember = item[prop];
            const {attributeName = prop, ...fieldSchema} = schema[prop];

            if (isKey(fieldSchema) && item[prop] !== undefined) {
                operationInput.Key[attributeName] = marshallValue(
                    fieldSchema,
                    inputMember
                );
            } else if (
                !skipVersionCheck &&
                isVersionAttribute(fieldSchema) &&
                inputMember !== undefined
            ) {
                const {condition: versionCondition} = handleVersionAttribute(
                    attributeName,
                    inputMember
                );

                condition = condition
                    ? {type: 'And', conditions: [condition, versionCondition]}
                    : versionCondition;
            }
        }

        if (condition) {
            const attributes = new ExpressionAttributes();
            operationInput.ConditionExpression = serializeConditionExpression(
                normalizeConditionExpressionPaths(
                    condition,
                    getAttributeNameMapping(schema)
                ),
                attributes
            );
            operationInput.ExpressionAttributeNames = attributes.names;
            operationInput.ExpressionAttributeValues = attributes.values;
        }

        const response = await this.client.deleteItem(operationInput).promise();
        if (response.Attributes) {
            return unmarshallItem<T>(schema, response.Attributes);
        }
    }

    async get<T extends object = StringToAnyObjectMap>({
        item,
        projection,
        tableDefinition: {tableName, schema},
        readConsistency = this.readConsistency,
    }: GetParameters & DataMapperParameters): Promise<T> {
        const operationInput: GetItemInput = {
            TableName: this.tableNamePrefix + tableName,
            Key: {},
            ConsistentRead: readConsistency === ReadConsistency.StronglyConsistent,
        };

        for (const prop of Object.keys(schema)) {
            const {attributeName = prop, ...fieldSchema} = schema[prop];
            if (isKey(fieldSchema) && item[prop] !== undefined) {
                operationInput.Key[attributeName] = marshallValue(
                    fieldSchema,
                    item[prop]
                );
            }
        }

        if (projection) {
            const attributes = new ExpressionAttributes();
            const mapping = getAttributeNameMapping(schema);
            operationInput.ProjectionExpression = serializeProjectionExpression(
                projection.map(propName => toSchemaName(propName, mapping)),
                attributes
            );
            operationInput.ExpressionAttributeNames = attributes.names;
        }

        const rawResponse = await this.client.getItem(operationInput).promise();
        if (rawResponse.Item) {
            return unmarshallItem<T>(schema, rawResponse.Item);
        }

        throw new ItemNotFoundException(operationInput);
    }

    async put<T extends object = StringToAnyObjectMap>({
        item,
        condition,
        returnValues = 'ALL_OLD',
        skipVersionCheck = this.skipVersionCheck,
        tableDefinition: {tableName, schema},
    }: PutParameters & DataMapperParameters): Promise<T|undefined> {
        const req: PutItemInput = {
            TableName: this.tableNamePrefix + tableName,
            Item: marshallItem(schema, item),
            ReturnValues: returnValues,
        };

        if (!skipVersionCheck) {
            for (const key of Object.keys(schema)) {
                let inputMember = item[key];
                const fieldSchema = schema[key];
                const {attributeName = key} = fieldSchema;

                if (isVersionAttribute(fieldSchema)) {
                    const {condition: versionCond} = handleVersionAttribute(
                        attributeName,
                        inputMember
                    );
                    if (req.Item[attributeName]) {
                        req.Item[attributeName].N = (
                            Number(req.Item[attributeName].N) + 1
                        ).toString();
                    } else {
                        req.Item[attributeName] = {N: "0"};
                    }

                    condition = condition
                        ? {type: 'And', conditions: [condition, versionCond]}
                        : versionCond;
                }
            }
        }

        if (condition) {
            const attributes = new ExpressionAttributes();
            req.ConditionExpression = serializeConditionExpression(
                normalizeConditionExpressionPaths(
                    condition,
                    getAttributeNameMapping(schema)
                ),
                attributes
            );
            req.ExpressionAttributeNames = attributes.names;
            req.ExpressionAttributeValues = attributes.values;
        }

        const response = await this.client.putItem(req).promise();
        if (response.Attributes) {
            return unmarshallItem<T>(schema, response.Attributes);
        }
    }

    async *query<T extends object = StringToAnyObjectMap>({
        filter,
        indexName,
        keyCondition,
        limit,
        projection,
        readConsistency = this.readConsistency,
        scanIndexForward,
        startKey,
        tableDefinition: {tableName, schema},
    }: QueryParameters & DataMapperParameters) {
        const req: QueryInput = {
            TableName: this.tableNamePrefix + tableName,
            ConsistentRead: readConsistency === ReadConsistency.StronglyConsistent,
            ScanIndexForward: scanIndexForward,
            Limit: limit,
            IndexName: indexName,
        };

        const attributes = new ExpressionAttributes();
        const mapping = getAttributeNameMapping(schema);

        req.KeyConditionExpression = serializeConditionExpression(
            normalizeConditionExpressionPaths(
                normalizeKeyCondition(keyCondition),
                mapping
            ),
            attributes
        );

        if (filter) {
            req.FilterExpression = serializeConditionExpression(
                normalizeConditionExpressionPaths(filter, mapping),
                attributes
            );
        }

        if (projection) {
            req.ProjectionExpression = serializeProjectionExpression(
                projection.map(propName => toSchemaName(propName, mapping)),
                attributes
            );
        }

        req.ExpressionAttributeNames = attributes.names;
        req.ExpressionAttributeValues = attributes.values;

        if (startKey) {
            req.ExclusiveStartKey = marshallItem(schema, startKey);
        }

        let result: QueryOutput;
        do {
            result = await this.client.query(req).promise();
            req.ExclusiveStartKey = result.LastEvaluatedKey;
            if (result.Items) {
                for (const item of result.Items) {
                    yield unmarshallItem<T>(schema, item);
                }
            }
        } while (result.LastEvaluatedKey !== undefined);
    }

    async *scan<T extends object = StringToAnyObjectMap>({
        filter,
        indexName,
        limit,
        projection,
        readConsistency = this.readConsistency,
        startKey,
        tableDefinition: {tableName, schema},
    }: ScanParameters & DataMapperParameters) {
        const req: ScanInput = {
            TableName: this.tableNamePrefix + tableName,
            ConsistentRead: readConsistency === ReadConsistency.StronglyConsistent,
            Limit: limit,
            IndexName: indexName,
        };

        const attributes = new ExpressionAttributes();
        const mapping = getAttributeNameMapping(schema);

        if (filter) {
            req.FilterExpression = serializeConditionExpression(
                normalizeConditionExpressionPaths(filter, mapping),
                attributes
            );
        }

        if (projection) {
            req.ProjectionExpression = serializeProjectionExpression(
                projection.map(propName => toSchemaName(propName, mapping)),
                attributes
            );
        }

        req.ExpressionAttributeNames = attributes.names;
        req.ExpressionAttributeValues = attributes.values;

        if (startKey) {
            req.ExclusiveStartKey = marshallItem(schema, startKey);
        }

        let result: ScanOutput;
        do {
            result = await this.client.scan(req).promise();
            req.ExclusiveStartKey = result.LastEvaluatedKey;
            if (result.Items) {
                for (const item of result.Items) {
                    yield unmarshallItem<T>(schema, item);
                }
            }
        } while (result.LastEvaluatedKey !== undefined);
    }

    async update<T extends object = StringToAnyObjectMap>({
        item,
        condition,
        tableDefinition: {tableName, schema},
        onMissing = OnMissingStrategy.Remove,
        skipVersionCheck = this.skipVersionCheck,
    }: UpdateParameters & DataMapperParameters): Promise<T> {
        const attributes = new ExpressionAttributes();
        const expr = new UpdateExpression({attributes});
        const req: UpdateItemInput = {
            TableName: this.tableNamePrefix + tableName,
            ReturnValues: 'ALL_NEW',
            Key: {},
        };

        for (const key of Object.keys(schema)) {
            let inputMember = item[key];
            const fieldSchema = schema[key];
            const {attributeName = key} = fieldSchema;

            if (isKey(fieldSchema)) {
                // Marshall keys into the `Keys` property and do not include
                // them in the update expression
                req.Key[attributeName] = marshallValue(
                    fieldSchema,
                    inputMember
                );
            } else if (isVersionAttribute(fieldSchema)) {
                const {condition: versionCond, value} = handleVersionAttribute(
                    attributeName,
                    inputMember
                );
                expr.set(attributeName, value);

                if (!skipVersionCheck) {
                    condition = condition
                        ? {type: 'And', conditions: [condition, versionCond]}
                        : versionCond;
                }
            } else if (inputMember === undefined) {
                if (onMissing === OnMissingStrategy.Remove) {
                    expr.remove(attributeName);
                }
            } else {
                expr.set(
                    attributeName,
                    new AttributeValue(marshallValue(fieldSchema, inputMember))
                );
            }
        }

        if (condition) {
            req.ConditionExpression = serializeConditionExpression(
                normalizeConditionExpressionPaths(
                    condition,
                    getAttributeNameMapping(schema)
                ),
                attributes
            );
        }

        req.UpdateExpression = expr.toString();
        req.ExpressionAttributeNames = attributes.names;
        req.ExpressionAttributeValues = attributes.values;

        const rawResponse = await this.client.updateItem(req).promise();
        if (rawResponse.Attributes) {
            return unmarshallItem<T>(schema, rawResponse.Attributes);
        }

        // this branch should not be reached when interacting with DynamoDB, as
        // the ReturnValues parameter is hardcoded to 'ALL_NEW' above. It is,
        // however, allowed by the service model and may therefore occur in
        // certain unforeseen conditions; to be safe, this case should be
        // converted into an error unless a compelling reason to return
        // undefined or an empty object presents itself.
        throw new Error(
            'Update operation completed successfully, but the updated value was not returned'
        );
    }
}

function handleVersionAttribute(
    attributeName: string,
    inputMember: any,
): {condition: ConditionExpression, value: MathematicalExpression|AttributeValue} {
    let condition: ConditionExpression;
    let value: any;
    if (inputMember === undefined) {
        condition = new FunctionExpression(
            'attribute_not_exists',
            new AttributePath([{type: 'AttributeName', name: attributeName}])
        );
        value = new AttributeValue({N: "0"});
    } else {
        condition = {
            type: 'Equals',
            subject: attributeName,
            object: inputMember,
        };
        value = new MathematicalExpression(
            new AttributePath(attributeName),
            '+',
            1
        );
    }

    return {condition, value};
}

type AttributeNameMapping = {[propName: string]: string};
function getAttributeNameMapping(schema: Schema): AttributeNameMapping {
    const mapping: AttributeNameMapping = {};

    for (const propName of Object.keys(schema)) {
        const {attributeName = propName} = schema[propName];
        mapping[propName] = attributeName;
    }

    return mapping;
}

function isKey(fieldSchema: SchemaType): boolean {
    return (
        fieldSchema.type === 'Binary' ||
        fieldSchema.type === 'Custom' ||
        fieldSchema.type === 'Date' ||
        fieldSchema.type === 'Number' ||
        fieldSchema.type === 'String'
    ) && fieldSchema.keyType !== undefined;
}

function isVersionAttribute(fieldSchema: SchemaType): boolean {
    return fieldSchema.type === 'Number'
        && Boolean(fieldSchema.versionAttribute);
}

function normalizeConditionExpressionPaths(
    expr: ConditionExpression,
    mapping: AttributeNameMapping
): ConditionExpression {
    if (FunctionExpression.isFunctionExpression(expr)) {
        return new FunctionExpression(
            expr.name,
            ...expr.args.map(arg => normalizeIfPath(arg, mapping))
        );
    }

    switch (expr.type) {
        case 'Equals':
        case 'NotEquals':
        case 'LessThan':
        case 'LessThanOrEqualTo':
        case 'GreaterThan':
        case 'GreaterThanOrEqualTo':
            return {
                ...expr,
                subject: toSchemaName(expr.subject, mapping),
                object: normalizeIfPath(expr.object, mapping),
            };

        case 'Between':
            return {
                ...expr,
                subject: toSchemaName(expr.subject, mapping),
                lowerBound: normalizeIfPath(expr.lowerBound, mapping),
                upperBound: normalizeIfPath(expr.upperBound, mapping),
            };
        case 'Membership':
            return {
                ...expr,
                subject: toSchemaName(expr.subject, mapping),
                values: expr.values.map(arg => normalizeIfPath(arg, mapping)),
            };
        case 'Not':
            return {
                ...expr,
                condition: normalizeConditionExpressionPaths(
                    expr.condition,
                    mapping
                ),
            };
        case 'And':
        case 'Or':
            return {
                ...expr,
                conditions: expr.conditions.map(condition =>
                    normalizeConditionExpressionPaths(condition, mapping)
                ),
            };
    }
}

function normalizeIfPath(path: any, mapping: AttributeNameMapping): any {
    if (AttributePath.isAttributePath(path)) {
        return toSchemaName(path, mapping);
    }

    return path;
}

function normalizeKeyCondition(
    keyCondition: ConditionExpression |
        {[key: string]: ConditionExpressionPredicate|any}
): ConditionExpression {
    if (isConditionExpression(keyCondition)) {
        return keyCondition;
    }

    const conditions: Array<ConditionExpression> = [];
    for (const property of Object.keys(keyCondition)) {
        const predicate = keyCondition[property];
        if (isConditionExpressionPredicate(predicate)) {
            conditions.push({
                ...predicate,
                subject: property,
            });
        } else {
            conditions.push({
                type: 'Equals',
                subject: property,
                object: predicate,
            });
        }
    }

    if (conditions.length === 1) {
        return conditions[0];
    }

    return {type: 'And', conditions};
}

function toSchemaName(
    path: AttributePath|string,
    mapping: AttributeNameMapping
): AttributePath|string {
    if (typeof path === 'string') {
        path = new AttributePath(path);
    }

    return new AttributePath(path.elements.map(el => {
        if (el.type === 'AttributeName' && el.name in mapping) {
            return {
                ...el,
                name: mapping[el.name],
            };
        }

        return el;
    }));
}
