const mongoose = require("mongoose");
const oscarSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
  },
  content: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  description: {
    type: String,
    required: false,
  },
  thumbnail: {
    data: Buffer,
    contentType: String,
    required: false,
  },
  size: {
    type: Number,
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
  visibility: {
    type: String,
    required: false,
  },
  author: {
    type: String,
    required: false,
  },
});

const OscarFile = mongoose.model("OscarFile", oscarSchema);
module.exports = OscarFile;
