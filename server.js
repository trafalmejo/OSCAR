// $ npm run package-win  
//import '/dist/css/grapes.min.css';
// If you need plugins, put them below the main grapesjs script
// import 'grapesjs-some-plugin';

var express = require('express')
var app = express()
var cors = require('cors')
var bodyParser = require('body-parser')

app.use(cors({credentials: true, origin: 'http://localhost:8080'}));
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({extended: false}));
app.use(bodyParser.json());
//  app.use((req, res, next) => {
//  	res.header('Access-Control-Allow-Origin', 'http://localhost:8080');
// 	res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
// 	if(req.method === 'OPTIONS'){
// 		req.header('Access-Control-Allow-Methods', 'PUT, POST, PATCH, DELETE, GET');
// 		return res.status(200).json({});
// 	}
// next();
//  });
var osc = require('osc');
//BRIDGE Between Client and Server
//var io = require('socket.io')(8081); 
var io = require('socket.io')(8081); 
var ipLibrary = require('ip');
var serverIP = ipLibrary.address() // my ip address


var code;
var store = {};
//Connection between Server and App to be controlled
var oscConnections = [];
var isConnected = [];

var udpPortGlobal = new osc.UDPPort({
	localAddress: serverIP,
	localPort: 7000,
	metadata: true,
});
udpPortGlobal.open()


//localhost
var udpPortLocal = new osc.UDPPort({
	localAddress: "localhost",
	localPort: 7001,
	metadata: true,
});
udpPortLocal.open()

//Send OSC Message over UDP
function sendOSCMessage(clientIP, ip, port, addressp, type, value) {
	var msg = {
		address: addressp,
		args: [
			{
				type: type,
				value: value
			}
		]
	};
	console.log("Sending message", msg.address, msg.args, "to", ip + ":" + port);

	if(ip == "localhost"){
		//ip = clientIP;
		try{
			udpPortLocal.send(msg, ip, port);
		} catch (err) {
			console.log("chatching this error")
			console.log("ERROR: ", err)
		}
	}
	else{
	try{
		udpPortGlobal.send(msg, ip, port);
	} catch (err) {
		console.log("chatching this error")
		console.log("ERROR: ", err)
	}
}
}

io.sockets.on('connection', function (socket) {
	console.log('Web sockect is connected between OSCAR and Local Server');
	socket.on("config", function (obj) {
		console.log("Receive Config: ", obj.client.host, obj.client.port)
		var device = { ip: obj.client.host, port: obj.client.port }
		oscConnections.push(device);
		isConnected.push(true);
	})
	socket.on("message", function (clientIP, ip, port, addressp, type, value) {
			try {
				sendOSCMessage(clientIP, ip, port, addressp, type, value);
			}
			catch (err) {
				console.log("ERROR: ", err)
			}
	});
	socket.on("code", function (obj) {
		//console.log(code);
		code = obj;
	});
})

//SERVER
app.post('/store', function (req, res) {
	store = req.body;
	res.send("HI GUYS");
})
app.get('/load', function (req, res) {
	res.send(store);
})
app.get('/preview', function (req, res) {
	res.sendfile(__dirname + '/public/preview.html');
})
app.get('/dom', function (req, res) {
	console.log("Requesting DOM", code)
	res.send(code)
}) 
app.get('/ipserver', function (req, res) {
	res.send(serverIP)
})
// app.listen(8080, config.ip, function () {	
// })
app.listen(8080, function () {
	
})





