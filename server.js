// $ npm run package-win  
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

function getSocket(hpp){
	for (let i = 0; i < oscClient.length; i++) {
		var socket = oscClient[i];
		var h = oscClient[i].host;
		var p = oscClient[i].port;
		//ID will be represented by the IP and PORT concatenated (host + port)
		var hp = h + "" + p;
		if(hp == hpp){
			return socket;
		}
	}
	return null;
}
io.sockets.on('connection', function (socket) {
	console.log('Connection');
	socket.on("config", function (obj) {

		//if (!isConnected) {
			//console.log('log', obj);
			oscServer = new osc.Server(obj.server.port, obj.server.host);
			var existingSocket = getSocket(obj.client.host +""+ obj.client.port);
			if(existingSocket == null){
				console.log("Socket existed before");
				var client = new osc.Client(obj.client.host, obj.client.port);
				oscClient.push(client);
				isConnected.push(true);
				client.send('/status', socket.sessionId + ' connected');
			}
			else{
				console.log("New socket created");
				existingSocket.send('/status', socket.sessionId + ' connected');
			}
			console.log("Number of Client: ",oscClient.length);
			oscServer.on('message', function(msg, rinfo) {
				socket.emit("message", msg);
			});
			socket.emit("Connected", 1);
		//}
	});
	socket.on("message", function (id, obj) {
 		// for (var i = oscClient.length - 1; i >= 0; i--) {
 		// 	if(oscClient[i].port == id){
			// oscClient[i].send.apply(oscClient[i], obj);
			// }
 		// }
		 //console.log("socket: ", oscClient[0]);
		var sent = false;
 		for (var i = 0; i < oscClient.length && !sent; i++) {
 			var h = oscClient[i].host;
			 var p = oscClient[i].port;
			 //ID will be represented by the IP and PORT concatenated (host + port)
 			var hp = h + "" + p;;
 			if(hp == id){
				 console.log('Socket in position: ', i);
				 console.log("hp: ", hp);
				 console.log("id: ", id);
				 oscClient[i].send.apply(oscClient[i], obj);
				 sent = true;
 			}
 		}
 	});
	// socket.on('disconnect', function(socket){
	// 	console.log("Disconnect all");
	// 	for (var i = 0; i < oscClient.length; i++) {
	// 		if (isConnected[i]) {
	// 			oscClient[i].kill();
	// 		}
	// 	}
	// });
	// socket.on('disconnectme', function(id){
	// 	for (var i = 0; i < oscClient.length; i++) {
	// 		var h = oscClient[i].host;
	// 		var p = oscClient[i].port;
	// 		var hp = h + "" + p;
	// 		if (isConnected[i] && id == hp) {
	// 			console.log("Disconnect");
	// 			//oscClient[i].kill();
	// 			isConnected[i] = false;
	// 		}
	// 	}
	// });
});


//SERVER
app.get('/', function (req, res) {
	res.send('Hello World!')
})

app.listen(8080, config.ip, function () {
	console.log('Example app listening on port 8080!')
})





