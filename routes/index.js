const express = require('express')
const router = express.Router();
const auth = require('../config/auth')
var BSON = require("bson");
const bcrypt = require('bcryptjs')
const passport = require('passport')
var ipLibrary = require('ip');
var serverIP = ipLibrary.address() // my ip address

//User model
const OscarFile = require('../models/OscarFile')

// Register Handle
router.post('/save', (req, res) => {
	//console.log('received data: ', req.body)
	const name = req.body.name;
	const overwrite = req.body.overwrite;
	const content = req.body;
	const size = BSON.calculateObjectSize(content);
	let errors = [];
	//Check required fields
	if (!name || !content || !size) {
		res.json({msg:'Data is incomplete. Be sure you pick a name for your project'})
	}
	else {
		//Validation passed
		OscarFile.findOne({ name: name })
			.then(file => {
				if (file) {
					if (overwrite) {
						//File is gonna be overwrite
						let oscarnewfile = {}
						oscarnewfile.name = name;
						oscarnewfile.content = content;
						oscarnewfile.size = size;

						let query = { _id:file._id }
						OscarFile.update(query, oscarnewfile, function (err) {
							if (err) {
								console.log(err)
								return;
							}
							else {
								res.json({msg:'Saved sucessfully'})
							}
						})
					} else {
						res.json({ errors: "There is a file with the same name, Do you want to overwrite?" });
					}
				} else {
					const newFile = new OscarFile({
						name,
						content,
						size
					})
					//console.log('new file')
					newFile.save()
					res.json({ msg: "Saved Successfully" });
				}
			});
	}
})
router.get('/load/:name', function (req, res) {
	//console.log(req.params.name)
	OscarFile.findOne({ name: req.params.name })
		.then(file => {
			if (file) {
				//User exists
				res.send(file.content);
			}
		});
})
router.get('/', function (req, res) {
	res.render('index');
})
router.get('/loggedin', function (req, res) {
	res.locals.user ? res.send(true) : res.send(false)
})
router.get('/preview', function (req, res) {
	res.sendfile(__dirname + '/public/preview.html');
})
router.get('/dom', function (req, res) {
	console.log("Requesting DOM", code)
	res.send(code)
})
router.get('/ipserver', function (req, res) {
	res.send(serverIP)
})

//Login Handle
router.post('/login', function (req, res, next) {
	let errors = [];
	const { email, password } = req.body;
	//Check required fields
	if (!email || !password) {
		errors.push({ msg: "Please fill in all fields" });
		res.json({ error: "Please fill the fields" });
	} else {
		passport.authenticate('local', function (err, user, info) {
			if (err) { return next(err); }
			if (!user) {
				req.flash('error_msg', 'Credentials are Incorrect')
				return res.json({ error: "Credentials are Incorrect" });
				//return res.redirect('index');
			}
			req.logIn(user, function (err) {
				if (err) {
					req.flash('error_msg', 'Credentials are Incorrect')
					res.json({ error: "Credentials are Incorrect" });
					return next(err);
				}
				return res.send({});
			});
		})(req, res, next);
	}
});

router.delete('/remove/:id', function(req,res){
    if(!req.user._id){
        res.status(500).send();
	}
	console.log(req.params.id)
    let query = {name:req.params.id}
    // OscarFile.findById(req.params.name, function(err, article){
        // if(article.author != ReadableStream.user._id){
        //     res.status(500).send()
        // }
        // else{
        //     res.send('Success')
        // }
	// })
	console.log(query.name)
    OscarFile.remove(query, function(err){
        if(err){
            console.log(err)
        }
        else{
        }
        res.json({msg:'Projected deleted'});

    })
})

//LogIn Handle
router.get('/login', (req, res) => {
	res.render('index');
})
//LogOut Handle
router.get('/logout', (req, res) => {
	req.logout();
	res.send({})
})






module.exports = router