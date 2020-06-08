require("dotenv/config");
const jwt = require("jsonwebtoken");

function auth(req, res, next) {
  const token = req.headers["x_auth_token"];
  //console.log(req);
  //const token = req.body.headers["x-auth-token"];
  //const token = req.headers;
  console.log("token");
  console.log(token);
  //console.log(token);
  //Check for token
  if (!token) {
    console.log("no token");
    return res.status(401).json({ msg: "Authorization denied" });
  }

  try {
    //Verified token
    const decoded = jwt.verify(token, process.env.jwtSecret);
    //Add user from payload
    req.user = decoded;
    next();
  } catch (e) {
    console.log("error token");
    console.log(e);
    res.status(400).json({ msg: "Request not valid" });
  }
}

module.exports = auth;
