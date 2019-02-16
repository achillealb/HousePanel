"use strict";
process.title = 'housepanel-push';

// websocket and http servers
var webSocketServer = require('websocket').server;
var http = require('http');
var fs = require('fs');

// list of currently connected clients (users)
var clients = [ ];

// array of all tiles in all hubs
var elements = [ ];

// options, config, and hubs taken from the main options file
var options;
var config;
var hubs;

// server variables
var server;
var app;
var wsServer;

try {
    // create the HTTP server for handling sockets
    server = http.createServer(function(request, response) {
    });

    // create the webSocket server
    wsServer = new webSocketServer({
        httpServer: server
    });

    // the Node.js app loop
    app = require('express')();
    var bodyParser = require('body-parser');
    app.use(bodyParser.json()); // for parsing application/json
    app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
} catch (e) {
    console.log("Error trying to create Node.js app and webSockcet server. housepanel-push is disabled.");
    server = null;
    wsServer = null;
    app = null;
}

function updateElements() {
    elements = [ ];
    hubs = null;

    // read options file here since it could have changed
    try {
        options = JSON.parse(fs.readFileSync('hmoptions.cfg', 'utf8'));
        config = options.config;
        hubs = config.hubs;
    } catch(e) {
        try {
            options = JSON.parse(fs.readFileSync('/var/www/html/housepanel/hmoptions.cfg', 'utf8'));
            config = options.config;
            hubs = config.hubs;
        } catch (e2) {
            hubs = null;
            console.log('housepanel-push installed; will be activated when first hub is authorized in HousePanel.');        
            return;
        }
    }

    if ( hubs && hubs.length && config.housepanel_url ) {
        console.log('housepanel-push installed. Elements being updated from ', hubs.length,' hubs to ', config.housepanel_url);
        var request = require('request');
        var num;
        for (num= 0; num< hubs.length; num++) {
            var numstr = num.toString();
            var parms = { url:config.housepanel_url, 
                          form:{useajax:'doquery',id:'all',type:'all',value:'none',attr:'none',hubnum:numstr}};
            request.post( parms, function (error, response, body) {
                if (response && response.statusCode == 200) {
                    var newitems = JSON.parse(body);
                    var hubnum = newitems.pop();
                    var hub = hubs[hubnum];
                    console.log('success reading', newitems.length,' elements from hub #', hubnum,
                                ' hub type: ', hub.hubType, ' hub name: ', hub.hubName);
                    // console.log( newitems );
                    newitems.forEach( function(item) {
                        elements.push(item);
                    });
                } else {
                    if ( error ) { console.log(error); }
                    console.log('error attempting to read hub #', num,' statusCode:',response.statusCode);
                }
            });
        }
    } else {
        console.log('housepanel-push installed; will be activated when first hub is authorized in HousePanel.');        
    }
    
    // list on the port
    if ( app && config && config.port ) {
        app.listen(config.port, function () {
            console.log("App Server is running on port: " + config.port);
        });
    }

    if ( server && config && config.webSocketServerPort ) {
        server.listen(config.webSocketServerPort, function() {
            console.log((new Date()) + " webSocket Server is listening on port " + config.webSocketServerPort);
        });
    }
}

// a callback function to tell user what to do if they point a browser here
if ( app ) {
    app.get("/", function (req, res) {
        res.send("This is housepanel-push used to forward state from hubs to HousePanel dashboards. <br>" +
                 "To use this you must install housepanel-push as a service. <br><br>" +
                 "Try running:  sudo systemctl restart housepanel-push");
        console.log("GET request");
    });
}

// handler for messages posted from the hub
if ( app ) {
    app.post("/", function (req, res) {

        // need this to avoid error for no response
        // res.json('thanks');
        
        // handle two types of messages posted from hub
        // the first initialize type tells Node.js to update elements
        if ( req.body['msgtype'] == "initialize" ) {
            res.json('hub info updated');
            console.log("New hub authorized; updating things in housepanel-push.");
            updateElements();

        } else if ( req.body['msgtype'] == "update" && elements && elements.length ) {

            // loop through all the elements for this hub
            // remove music trackData field that we don't know how to handle
            var cnt = 0;
            for (var num= 0; num< elements.length; num++) {

                var entry = elements[num];
                if ( entry.id == req.body['change_device'].toString() &&
                    req.body['change_attribute']!='trackData' &&
                    entry['value'][req.body['change_attribute']] != req.body['change_value'] )
                {
                    cnt = cnt + 1;
                    // console.log(entry['value']);
                    entry['value'][req.body['change_attribute']] = req.body['change_value'];
                    if ( entry['value']['trackData'] ) { delete entry['value']['trackData']; }
                    console.log('updating tile #',entry['id'],' from trigger:',req.body['change_attribute'],' value= ',entry['value']);

                    // send the updated element to all clients
                    // this is processed by the webSockets client in housepanel.js
                    for (var i=0; i < clients.length; i++) {
                        // clients[i].sendUTF(JSON.stringify(elements));
                        clients[i].sendUTF(JSON.stringify(entry));
                    }
                }
            }
            res.json('pushed new status info to ' + cnt + ' tiles');
        }

    });
}

// This callback function is called every time someone
// tries to connect to the WebSocket server
if ( wsServer ) {
    wsServer.on('request', function(request) {
        console.log((new Date()) + ' Connection from origin ' + request.origin + '.');

        // accept connection - you should check 'request.origin' to make sure that
        // client is connecting from your website
        // (http://en.wikipedia.org/wiki/Same_origin_policy)
        var connection = request.accept(null, request.origin); 
        // we need to know client index to remove them on 'close' event
        var index = clients.push(connection) - 1;

        console.log((new Date()) + ' Connection accepted.');

    //    if (elements != null) {
    //        connection.sendUTF(JSON.stringify(elements));
    //    }
        // user sent some message
        // any message signals need to refresh the elements
        connection.on('message', function(message) {
            console.log("Message received from HousePanel; updating things in housepanel-push.");
            updateElements();
        });

        // user disconnected
        connection.on('close', function(connection) {
            console.log((new Date()) + " Peer " + connection.remoteAddress + " disconnected.");

            // remove user from the list of connected clients
            clients.splice(index, 1);
        });

    });
}

// start with an initial list of all elements
// this is updated when any hub is reinstalled
updateElements();