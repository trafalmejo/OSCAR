// $ npm run package-win  
//import '/dist/css/grapes.min.css';
// If you need plugins, put them below the main grapesjs script
// import 'grapesjs-some-plugin';
const socketport = 8081;
const httpport = 8080;
const lanport = 5001;
const localport = 5002;
const open = require('open');
var express = require('express')
var app = express()
const mongoose = require('mongoose')
var cors = require('cors')
var bodyParser = require('body-parser')
var osc = require('osc');
//BRIDGE Between Client and Server
var io = require('socket.io')(socketport);
var ipLibrary = require('ip');
var serverIP = ipLibrary.address() // my ip address
var path = require('path');
const passport = require('passport')
const session = require('express-session')
const auth = require('./config/auth')
const flash = require('connect-flash')
var cookieParser = require('cookie-parser');

//Passport config
require('./config/passport')(passport);
//DB
const db = require("./config/keys").MongoURI;

//Connect to Mongo
mongoose.connect(db, { useNewUrlParser: true })
	.then(() => console.log('MongoDB Connected'))
	.catch(err => console.log(err));

//User model
const OscarFile = require('./models/OscarFile')

//EJS
app.set('views', path.join(__dirname, '/public'));
app.set('view engine', 'ejs')



//app.use(cors())
app.use(cors({ credentials: true, origin: 'http://localhost:' + httpport }));
app.use(express.static(__dirname + '/public'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());


app.use(cookieParser('secret'));

//Express Session
app.use(session({
	cookie: { maxAge: 60000 },
	secret: 'oscarsecret',
	resave: true,
	saveUninitialized: true,
}))
//After session it goes Passport Middleware
app.use(passport.initialize());
app.use(passport.session());

 // Connect Flash
 app.use(flash());

 //Global Vars
 app.use(function(req, res, next){
    res.locals.success_msg = req.flash('success_msg')
    res.locals.error_msg = req.flash('error_msg')
    res.locals.error = req.flash('error')
    next()
 })

var code;

var udpPortGlobal = new osc.UDPPort({
	localAddress: serverIP,
	localPort: localport,
	metadata: true,
});
udpPortGlobal.open()


//Localhost
var udpPortLocal = new osc.UDPPort({
	localAddress: "localhost",
	localPort: lanport,
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

	if (ip == "localhost") {
		//ip = clientIP;
		try {
			udpPortLocal.send(msg, ip, port);
		} catch (err) {
			console.log("chatching this error")
			console.log("ERROR: ", err)
		}
	}
	else {
		try {
			udpPortGlobal.send(msg, ip, port);
		} catch (err) {
			console.log("chatching this error")
			console.log("ERROR: ", err)
		}
	}
}
io.sockets.on('connection', function (socket) {
	console.log('Web sockect is connected between OSCAR and Local Server');
	// socket.on("config", function (obj) {
	// 	console.log("Receive Config: ", obj.client.host, obj.client.port)
	// 	var device = { ip: obj.client.host, port: obj.client.port }
	// 	oscConnections.push(device);
	// 	isConnected.push(true);
	// })
	socket.on("message", function (clientIP, ip, port, addressp, type, value) {
		try {
			sendOSCMessage(clientIP, ip, port, addressp, type, value);
		}
		catch (err) {
			console.log("ERROR: ", err)
		}
	});
	socket.on("code", function (obj) {
		code = obj;
	});
})

 //local variables
 app.locals.projects = [{ name: "", size: 0, date: {} }]
 app.locals.user = null
 

//User Global
app.get('*', function (req, res, next) {
	res.locals.user = req.user || null;
	next();
});
app.get('/test', (req, res) => {
	req.flash('error_msg', 'falashasdasfafs')
	res.render('test')
})
//Projects
app.get('/projects', auth.ensureAuthenticated, (req, res) => {
	let projects = [];

	//Obtain projects
	OscarFile.find({})
		.then(file => {
			if (file) {
				//file exists
				projects = file;
				app.locals.projects = projects
				//send data
				res.json(projects)
			}
		});
}
)

//Routes
app.use('/', require('./routes/index'))

app.listen(httpport, function () {
	console.log("Open any browser connected to the same network on: ", "http://" + serverIP + ":" + httpport)
	open("http://" + serverIP + ":" + httpport);
})





