//import '/dist/css/grapes.min.css';
// If you need plugins, put them below the main grapesjs script
// import 'grapesjs-some-plugin';

//var grapesjs = require('grapejs')
var express = require('express')
var app = express()
app.use(express.static(__dirname + '/public'));
//OSC library = node-osc
var osc = require('node-osc');
var io = require('socket.io')(8081);
var config = require("./public/config.js");

//BRIDGE

var oscServer;
var oscClient = [];
var isConnected = [];

io.sockets.on('connection', function (socket) {
	console.log('Connection');
	socket.on("config", function (obj) {
		//if (!isConnected) {
			console.log('log', obj);
			oscServer = new osc.Server(obj.server.port, obj.server.host);
			var client = new osc.Client(obj.client.host, obj.client.port);
			oscClient.push(client);
			isConnected.push(true);
			client.send('/status', socket.sessionId + ' connected');
			oscServer.on('message', function(msg, rinfo) {
				socket.emit("message", msg);
			});
			socket.emit("Connected", 1);
		//}
	});
	socket.on("message", function (id, obj) {

 		console.log("socket: ", oscClient[0]);
 		for (var i = 0; i < oscClient.length; i++) {
 			var h = oscClient[i].host;
 			var p = oscClient[i].port;
 			var hp = h + "" + p;
 			console.log("hp: ", hp);
 			console.log("id: ", id);
 			if(hp == id){
 				console.log('socket in position: ', i);
 				oscClient[i].send.apply(oscClient[i], obj);
 			}else{
 				console.log("not")
 			}
 		}
 		

 	});
	socket.on('disconnect', function(socket){
		console.log("Disconnect all");
		for (var i = 0; i < oscClient.length; i++) {
			if (isConnected[i]) {
				oscClient[i].kill();
			}
		}

	});
	socket.on('disconnectme', function(id){
		for (var i = 0; i < oscClient.length; i++) {
			var h = oscClient[i].host;
			var p = oscClient[i].port;
			var hp = h + "" + p;
			if (isConnected[i] && id == hp) {
				console.log("Disconnect");
				oscClient[i].kill();
				isConnected[i] = false;
			}
		}
	});
});


//SERVER
app.get('/', function (req, res) {
	res.send('Hello World!')
})

app.listen(8080, config.ip, function () {
	console.log('Example app listening on port 8080!')
})



