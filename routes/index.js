const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
var BSON = require("bson");
const bcrypt = require("bcryptjs");
const passport = require("passport");
var ipLibrary = require("ip");
var serverIP = ipLibrary.address(); // my ip address
const axios = require("axios");
require("dotenv/config");

// Register Handle
router.post("/save", auth, (req, res) => {
  const name = req.body.name;
  const content = req.body;
  const size = BSON.calculateObjectSize(content);
  req.body.author = req.user.id;
  //console.log(req.user);
  //console.log("savee");
  //console.log(req.body);

  //Check required fields
  if (!name || !content || !size) {
    res.json({
      error: "Data is incomplete. Be sure you pick a name for your project",
    });
  } else {
    axios
      .post(
        process.env.serverURL + "api/projects",
        req.body,
        tokenConfig(req.headers["x_auth_token"])
      )
      .then((response) => {
        console.log("saving...");
        console.log(response.data);
        if (response.data.msg) {
          res.json({ msg: response.data.msg });
        } else if (response.data.confirm) {
          res.json({ confirm: response.data.confirm });
        }
        //res.json({ msg: "Saved sucessfully" });
      })
      .catch((err) => {
        console.log("saving error...");
        console.log(err);
        res.json({ error: "Could not be saved" });
      });
  }
});
router.get("/load/:name", auth, function (req, res) {
  console.log("load triguered");
  //console.log(req);
  if (!req.params.name) {
    res.json({
      error: "Data is incomplete. Be sure you pick a name for your project",
    });
  } else {
    axios
      .post(
        process.env.serverURL + "api/projects/" + req.params.name,
        tokenConfig(req.headers["x_auth_token"])
      )
      .then((data) => {
        console.log("loading...");
        //console.log(data);
        res.send(data.data);
      })
      .catch((err) => {
        console.log("loading error...");
        //console.log(err);
        res.json({ error: "Could not be loaded" });
      });
  }
});
router.get("/", function (req, res) {
  res.render("index");
});
router.get("/upgrade", function (req, res) {
  res.json({ success: true });
});

router.get("/dom", function (req, res) {
  console.log("Requesting DOM", code);
  res.send(code);
});
router.get("/ipserver", function (req, res) {
  res.send(serverIP);
});
router.get("/preview", function (req, res) {
  //res.sendfile(__dirname + '/public/preview.html');
  res.render("preview");
});

router.delete("/remove/:id", auth, function (req, res) {
  console.log("requesting deleting");
  if (!req.user.id) {
    res.status(500).send();
  } else {
    axios
      .delete(
        process.env.serverURL + "api/projects/" + req.params.id,
        req.body,
        tokenConfig(req.headers["x_auth_token"])
      )
      .then((response) => {
        console.log("deleting...");
        //console.log(response);
        res.json({ msg: response.data.msg });
      })
      .catch((err) => {
        console.log("deleting error...");
        console.log(err);
        res.json({ error: "Could not be deleted" });
      });
  }
});

//Projects
router.get("/projects", (req, res) => {
  console.log("token received by table");
  console.log(req.headers["x_auth_token"]);
  axios
    .post(
      process.env.serverURL + "api/projects/all",
      tokenConfig(req.headers["x_auth_token"])
    )
    .then((response) => {
      console.log("loading table...");
      //console.log(response.data);
      res.json(response.data);
      //console.log(res);
      //res.json({ msg: "Deleted sucessfully" });
    })
    .catch((err) => {
      console.log("loading table error...");
      console.log(err);
      //res.json({ err: "Could not be deleted" });
    });
});
const tokenConfig = (tokenp) => {
  //Get Token from Local Storage
  const token = tokenp;
  //headers
  const config = {
    headers: {
      "Content-type": "application/json",
    },
  };
  //If tokem, add to headers
  if (token) {
    config.headers["x_auth_token"] = token;
  }
  return config;
};

module.exports = router;
