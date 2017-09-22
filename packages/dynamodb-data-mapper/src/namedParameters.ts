import DynamoDB = require("aws-sdk/clients/dynamodb");
import {OnMissingStrategy, ReadConsistency} from "./constants";
import {TableDefinition} from "@aws/dynamodb-data-marshaller";
import {
    ConditionExpression,
    ConditionExpressionPredicate,
    ProjectionExpression,
} from "@aws/dynamodb-expressions";
import {ReturnValue} from 'aws-sdk/clients/dynamodb';

export type StringToAnyObjectMap = {[key: string]: any};

export interface DataMapperConfiguration {
    /**
     * The low-level DynamoDB client to use to execute API operations.
     */
    client: DynamoDB;

    /**
     * The default read consistency to use when loading items. If not specified,
     * {ReadConsistency.EventuallyConsistent} will be used.
     */
    readConsistency?: ReadConsistency;

    /**
     * Whether operations should NOT by default honor the version attribute
     * specified in the schema by incrementing the attribute and preventing the
     * operation from taking effect if the local version is out of date.
     */
    skipVersionCheck?: boolean;

    /**
     * A prefix to apply to all table names.
     */
    tableNamePrefix?: string;
}

export interface DataMapperParameters {
    /**
     * The schema and table name to use for this operation.
     */
    tableDefinition: TableDefinition;
}

export interface DeleteParameters<T extends object = StringToAnyObjectMap> {
    /**
     * The item being deleted.
     */
    item: T;

    /**
     * A condition on which this delete operation's completion will be
     * predicated.
     */
    condition?: ConditionExpression;

    /**
     * The values to return from this operation.
     */
    returnValues?: 'ALL_OLD'|'NONE';

    /**
     * Whether this operation should NOT honor the version attribute specified
     * in the schema by incrementing the attribute and preventing the operation
     * from taking effect if the local version is out of date.
     */
    skipVersionCheck?: boolean;
}

export interface GetParameters<T extends object = StringToAnyObjectMap> {
    /**
     * The item being loaded.
     */
    item: T;

    /**
     * The read consistency to use when loading the requested item.
     */
    readConsistency?: ReadConsistency;

    /**
     * The item attributes to get.
     */
    projection?: ProjectionExpression;
}

export interface PutParameters<T extends object = StringToAnyObjectMap> {
    /**
     * The object to be saved.
     */
    item: T;

    /**
     * A condition on whose evaluation this put operation's completion will be
     * predicated.
     */
    condition?: ConditionExpression;

    /**
     * The values to return from this operation.
     */
    returnValues?: 'ALL_OLD'|'NONE';

    /**
     * Whether this operation should NOT honor the version attribute specified
     * in the schema by incrementing the attribute and preventing the operation
     * from taking effect if the local version is out of date.
     */
    skipVersionCheck?: boolean;
}

export interface QueryParameters {
    /**
     * A string that contains conditions that DynamoDB applies after the Query
     * operation, but before the data is returned to you. Items that do not
     * satisfy the FilterExpression criteria are not returned.
     *
     * A FilterExpression does not allow key attributes. You cannot define a
     * filter expression based on a partition key or a sort key.
     */
    filter?: ConditionExpression;

    /**
     * The name of an index to query. This index can be any local secondary
     * index or global secondary index on the table.
     */
    indexName?: string;

    /**
     * The condition that specifies the key value(s) for items to be retrieved
     * by the Query action.
     */
    keyCondition: ConditionExpression |
        {[propertyName: string]: ConditionExpressionPredicate|any};

    /**
     * The maximum number of items to fetch per page of results.
     */
    limit?: number;

    /**
     * The item attributes to get.
     */
    projection?: ProjectionExpression;

    /**
     * The read consistency to use when loading the query results.
     */
    readConsistency?: ReadConsistency;

    /**
     * Specifies the order for index traversal: If true, the traversal is
     * performed in ascending order; if false, the traversal is performed in
     * descending order.
     *
     * Items with the same partition key value are stored in sorted order by
     * sort key. If the sort key data type is Number, the results are stored in
     * numeric order. For type String, the results are stored in order of ASCII
     * character code values. For type Binary, DynamoDB treats each byte of the
     * binary data as unsigned.
     */
    scanIndexForward?: boolean;

    /**
     * The primary key of the first item that this operation will evaluate.
     */
    startKey?: {[key: string]: any};
}

export interface ScanParameters<T extends object = StringToAnyObjectMap> {
    /**
     * A string that contains conditions that DynamoDB applies after the Query
     * operation, but before the data is returned to you. Items that do not
     * satisfy the FilterExpression criteria are not returned.
     *
     * A FilterExpression does not allow key attributes. You cannot define a
     * filter expression based on a partition key or a sort key.
     */
    filter?: ConditionExpression;

    /**
     * The name of an index to query. This index can be any local secondary
     * index or global secondary index on the table.
     */
    indexName?: string;

    /**
     * The maximum number of items to fetch per page of results.
     */
    limit?: number;

    /**
     * The item attributes to get.
     */
    projection?: ProjectionExpression;

    /**
     * The read consistency to use when loading the query results.
     */
    readConsistency?: ReadConsistency;

    /**
     * Specifies the order for index traversal: If true, the traversal is
     * performed in ascending order; if false, the traversal is performed in
     * descending order.
     *
     * Items with the same partition key value are stored in sorted order by
     * sort key. If the sort key data type is Number, the results are stored in
     * numeric order. For type String, the results are stored in order of ASCII
     * character code values. For type Binary, DynamoDB treats each byte of the
     * binary data as unsigned.
     */
    scanIndexForward?: boolean;

    /**
     * The primary key of the first item that this operation will evaluate.
     */
    startKey?: {[key: string]: any};
}

export interface UpdateParameters<T extends object = StringToAnyObjectMap> {
    /**
     * The object to be saved.
     */
    item: T;

    /**
     * A condition on whose evaluation this update operation's completion will
     * be predicated.
     */
    condition?: ConditionExpression;

    /**
     * Whether the absence of a value defined in the schema should be treated as
     * a directive to remove the property from the item.
     */
    onMissing?: OnMissingStrategy;

    /**
     * The values to return from this operation.
     */
    returnValues?: ReturnValue;

    /**
     * Whether this operation should NOT honor the version attribute specified
     * in the schema by incrementing the attribute and preventing the operation
     * from taking effect if the local version is out of date.
     */
    skipVersionCheck?: boolean;
}
