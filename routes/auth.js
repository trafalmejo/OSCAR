const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
require("dotenv/config");
const jwt = require("jsonwebtoken");
const auth = require("../middleware/auth");
const axios = require("axios");

//Project Model
const User = require("../models/User");

// @route POST request auth /auth
// @desc Authentincate user
// @access Public
router.post("/", (req, res) => {
  //console.log("login request");
  const { email, password } = req.body;

  //Simple validation
  if (!email || !password) {
    return res.status(400).json({ msg: "Please enter all fields" });
  }
  //Login User
  //headers
  const config = {
    headers: {
      "Content-Type": "application/json",
    },
  };
  //Request body
  const body = JSON.stringify({ email, password });

  axios
    .post(process.env.serverURL + "api/auth", body, config)
    .then((response) => {
      //console.log("login axios res");
      console.log(response.data);
      res.json(response.data);
      //console.log(res);
    })
    .catch((err) => {
      //console.log("Error login");
      // console.log(err);
      if (typeof err.response !== "undefined") {
        return res.status(400).json({ msg: err.response.data.msg });
      } else {
        return res.status(400).json({ msg: "Check your Internet Connection" });
      }
    });
});

// @route POST request auth/user
// @desc POST user data
// @access Private
//is logged In?
router.post("/user", (req, res) => {
  //console.log("asking for if user is logged in");
  //console.log(req.headers["x_auth_token"]);
  axios
    .post(
      process.env.serverURL + "api/auth/user",
      tokenConfig(req.headers["x_auth_token"])
    )
    .then((response) => {
      //console.log("is authenticated?");
      //console.log(response.data);
      res.json({ data: response.data });
    })
    .catch((err) => {
      //console.log("catched");
      //console.log(err);
      //console.log(err);
      //console.log(err.response.data.msg);
      res.sendStatus(400);
    });
  // User.findById(req.user.id)
  //   .select("-password")
  //   .then((user) => res.json(user));
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
  //console.log("config");
  //console.log(config);
  return config;
};
module.exports = router;
