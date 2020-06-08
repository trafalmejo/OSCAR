const mongoose = require('mongoose')
const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    lastname: {
        type: String,
        required: true
    },
    isVerified: {
        type: Boolean,
        required: false
    },
    email: {
        type: String,
        required: true
    },
    password: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        default: Date.now
    },
    projects: {
        type: [{ type : mongoose.Schema.Types.ObjectId, ref: 'OscarFile' }],
        required: true
    }
});

const User = mongoose.model('User', userSchema);
module.exports = User;