'use strict';

const AWS = require("aws-sdk"),
      dynamo = new AWS.DynamoDB.DocumentClient();


/**
 * Dynamo Save
 *
 * @param {Object} data - The data to save
 * @return {Promise} A Promise with the save results
 */
exports.save = function(data, table = null) {
  let params = { Item: data };
  if (table) params.TableName = table;
  return this.query('put', params);
}


/**
 * Dynamo Get
 *
 * @param {String} id - The record's key
 * @return {Promise} A Promise with the get result
 */
exports.get = function(id, table = null) {
  let params = { Key: { id: id } };
  if (table) params.TableName = table;
  return this.query('get', params).then(d => {
    return Promise.resolve(d.Item);
  });
}


/**
 * Dynamo Query
 *
 * @param {String} name - The query action to run
 * @param {Object} params - The query parameters
 * @return {Promise} A Promise with the get result
 */
exports.query = function(method, params) {
  if (!params.TableName) params.TableName = process.env.TABLE_NAME;

  return new Promise((resolve, reject) => {
    dynamo[method](params, (err, data) => {
      err ? reject(err) : resolve(data);
    });
  });
}