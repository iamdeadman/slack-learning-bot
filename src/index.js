'use strict';

// Include the serverless-slack bot framework
const slack = require('serverless-slack');
const DynamoDB = require("./dynamo");
const slackifyMarkdown = require('slackify-markdown');

const DEFAULT_DIALOG_PARAMS = {
  title: "New Item",
  submit_label: 'Save',
  notify_on_cancel: false,
  elements: [
    {type: "text", placeholder: "What are you learning?", name: "subject", label: "What"},
    {
      type: "select", label: 'Status', name: 'status', options: [
        {label: "Started", value: 'started'}, {label: "Completed", value: 'completed'}, {label: "OnHold", value: 'onhold'},
      ]
    },
    {type: "textarea", placeholder: "Please enter your notes, learning resources, etc. here, Markdown is supported", name: "source", label: "Notes"},
  ]
};

// The function that AWS Lambda will call
exports.handler = slack.handler.bind(slack);

function makeid(length) {
  var result           = '';
  var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var charactersLength = characters.length;
  for ( var i = 0; i < length; i++ ) {
     result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return result;
}

const SaveLearningRecord = (record, bot, message = false) => {
  DynamoDB.save(record, process.env.DATA_TABLE_NAME).then(response => {
    if (message) bot.replyPrivate("Data saved successfully.").then(response => {console.log(response);}).catch(error => {console.log(error);});
  }).catch(error => {
    console.log(error);
    bot.replyPrivate("Error saving data. Please try again").then(response => {console.log(response);}).catch(error => {console.log(error);});
  });
};

const UpdateUserName = (user_id, team_id, bot) => {
  DynamoDB.get(team_id, process.env.DATA_TABLE_NAME).then(record => {
    if(!record) record = {id: team_id};
    if(!record.data_names) record.data_names = {};
    bot.send("users.info", {user: user_id}).then(user_response => {
      const {user: {real_name}} = user_response;
      if (real_name) {
        record.data_names[user_id] = real_name;
        SaveLearningRecord(record, bot, false); 
      }
    }).catch(error => {
      console.log(error);
    });
  }).catch(error => {
      console.log(error);
  })
};

// Slash Command handler
slack.on('/learning', (msg, bot) => {
  let message = '';
  const {text, trigger_id, user_id, team_id} = msg;

  if(text) {
    message = text.trim();
  }
  let dialog = DEFAULT_DIALOG_PARAMS;
  if (message === 'new') {
    dialog.callback_id = makeid(16);
    dialog.title = "New Item";
    delete dialog.elements[0].value;
    delete dialog.elements[1].value;
    delete dialog.elements[2].value;
    let data = {trigger_id, dialog: JSON.stringify(dialog)};
    bot.send("dialog.open", data).then(response => {
      UpdateUserName(user_id, team_id, bot);
    }).catch(error => {
      console.log(error);
      bot.replyPrivate("Error creating dialog request. Please try again").then(response => {console.log(response);}).catch(error => {console.log(error);});
    });
  } else if(message.startsWith("update") || message.startsWith("delete")) {
    DynamoDB.get(team_id, process.env.DATA_TABLE_NAME).then(record => {
      if (record) {
        if (message.split(" ").length === 1) {
          if (record[user_id] && record[user_id].length > 0) {
            let blocks = [
              {
                "type": "section",
                "text": {
                  "type": "mrkdwn",
                  "text": "Select item to " + message
                },
                "accessory": {
                  "type": "static_select",
                  "placeholder": {
                    "type": "plain_text",
                    "text": "Select a subject",
                    "emoji": true
                  },
                  "options": record[user_id]
                    .filter(item => item.subject != null)
                    .map(item => {
                      return {text: {type: "plain_text", text: item.subject, emoji: true}, value: message + "_:_" + item.subject};
                    })
                }
              }
            ];
            bot.replyPrivate({blocks, text: "Select subject to " + message}).then(response => {console.log(response);}).catch(error => {console.log(error);});
          } else bot.replyPrivate("No learning data found for provided user").then(response => {console.log(response);}).catch(error => {console.log(error);});
        } else {
          let subject = message.split(" ").pop(), index = -1;
          if (!isNaN(parseInt(subject))) {
            index = parseInt(subject) - 1;
          }
          if (index == -1 && record[user_id] && record[user_id].length > 0) {
            for (var i = 0; i < record[user_id].length; i++) {
              if (record[user_id][i].subject && record[user_id][i].subject.toLowerCase() === subject.toLowerCase()) {
                index = i;
                break;  
              }
            } 
          }
          if (index > -1 && record[user_id] && record[user_id].length > index) {
            if (message.startsWith("delete")) {
              record[user_id].splice(index, 1);
              SaveLearningRecord(record, bot, true);
            } else {
              dialog.callback_id = makeid(16) + "_:_" + index.toString();
              dialog.title = "Update Item";
              
              let item = record[user_id][index];
              if (item.subject) dialog.elements[0].value = item.subject;
              if (item.source) dialog.elements[2].value = item.source;
              if (item.status) dialog.elements[1].value = item.status;
  
              let data = {trigger_id, dialog: JSON.stringify(dialog)};
              bot.send("dialog.open", data).then(response => {
                UpdateUserName(user_id, team_id, bot);
              }).catch(error => {
                console.log('err:', error);
                bot.replyPrivate("Error creating dialog request. Please try again").then(response => {console.log(response);}).catch(error => {console.log(error);});          
              });
            }
          } else bot.replyPrivate("Learning subject with given id not found").then(response => {console.log(response);}).catch(error => {console.log(error);});
        }
      } else bot.replyPrivate("Team learning data not found. Please try again").then(response => {console.log(response);}).catch(error => {console.log(error);});
    }).catch(error => {
      console.log(error);
      bot.replyPrivate("Error fetching data for provided user").then(response => {console.log(response);}).catch(error => {console.log(error);});  
    });
  } else {
    let username = user_id;
    let regex = new RegExp("<@([0-9a-z]+)|.+>", "i");
    if (message && message.length > 0) {
      if (regex.test(message)) {
        let regexParts = message.match(regex);
        if (regexParts.length > 1) {
          username = regexParts[1];
        }
      } else {
        bot.replyPrivate("Invalid command syntax. Correct syntax is /learning [new|get @username]").then(response => {console.log(response);}).catch(error => {console.log(error);});
        return;
      }
    }
    DynamoDB.get(team_id, process.env.DATA_TABLE_NAME).then(record => {
      if(record[username] && record[username].length > 0) {
        let title = "Learning plan:";
        if (record.data_names && record.data_names[username]) title = "Learning plan for " + record.data_names[username] + ":"; 
        let blocks = [{type: "divider"}, {
          "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": title
            }
        }];
        for (var i = 0; i < record[username].length; i++) {
          let submission = record[username][i];
          blocks = blocks.concat([{
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "(" + (i+1) + ") *Subject:* " + submission.subject + ", *Status:* " + submission.status + ", Notes:"
            }
          }, {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": slackifyMarkdown(submission.source)
            }
          }]);
        }
        blocks.push({type: "divider"});
        bot.replyPrivate({blocks: blocks, text: "Currently learning"}).then(response => {console.log(response);}).catch(error => {console.log(error);});
      } else bot.replyPrivate("No learning data found for provided user").then(response => {console.log(response);}).catch(error => {console.log(error);});
    }).catch(error => {
      console.log(error);
      bot.replyPrivate("Error fetching data for provided user").then(response => {console.log(response);}).catch(error => {console.log(error);});
    });
  }
});

slack.on('dialog_submission', (msg, bot) => {
  const {submission, user, team, callback_id} = msg; 
  let callbackParts = callback_id.split("_:_");
  DynamoDB.get(team.id, process.env.DATA_TABLE_NAME).then(record => {
    if(!record) record = {id: team.id};
    if(!record[user.id]) record[user.id] = [];
    if (callbackParts.length === 2 && !isNaN(parseInt(callbackParts[1]))) {
      let id = parseInt(callbackParts[1]);
      if (id === -1) record[user.id].push(submission);
      else if (record[user.id].length > id) {
        if (submission.subject) record[user.id][id].subject = submission.subject;
        if (submission.source) record[user.id][id].source = submission.source;
        if (submission.status) record[user.id][id].status = submission.status;
      }
    } else if (callbackParts.length === 1) record[user.id].push(submission);
    SaveLearningRecord(record, bot, true);
  }).catch(error => {
    console.log(error);
    bot.replyPrivate("Error saving data. Please try again").then(response => {console.log(response);}).catch(error => {console.log(error);});
  });
});

slack.on("block_actions", (msg, bot) => {
  const {user, team, trigger_id, actions} = msg;
  if (actions && actions.length > 0 && actions[0].type === 'static_select') {
    DynamoDB.get(team.id, process.env.DATA_TABLE_NAME).then(record => {
      if(!record) record = {id: team.id};
      if(!record[user.id]) record[user.id] = [];
      let id = -1;
      const {selected_option: {value}} = actions[0];
      if (value.split("_:_").length === 2 && record[user.id] && record[user.id].length > 0) {
        let subject = value.split("_:_")[1];
        let action = value.split("_:_")[0];
        for (var i = 0; i < record[user.id].length; i++) {
          if (record[user.id][i].subject && record[user.id][i].subject === subject) {
            id = i;
            break;
          }
        }
        if (id > -1 && record[user.id].length > id) {
          if (action.toLowerCase() === 'update') {
            let dialog = DEFAULT_DIALOG_PARAMS;
            dialog.callback_id = makeid(16) + "_:_" + id.toString();
            dialog.title = "Update Item";
            let item = record[user.id][id];
            if (item.subject) dialog.elements[0].value = item.subject;
            if (item.source) dialog.elements[2].value = item.source;
            if (item.status) dialog.elements[1].value = item.status;
            let data = {trigger_id, dialog: JSON.stringify(dialog)};
            bot.send("dialog.open", data).then(response => {
              UpdateUserName(user.id, team.id, bot);
            }).catch(error => {
              console.log('err:', error);
              bot.replyPrivate("Error creating dialog request. Please try again").then(response => {console.log(response);}).catch(error => {console.log(error);});
            });
          } else if (action.toLowerCase() === 'delete') {
            record[user.id].splice(id, 1);
            SaveLearningRecord(record, bot, true);
          }
        }
      }
    }).catch(error => {
      console.log(error);
      bot.replyPrivate("Error saving data. Please try again").then(response => {console.log(response);}).catch(error => {console.log(error);});
    });
  }
});