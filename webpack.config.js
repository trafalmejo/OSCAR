module.exports = {
    entry: './public/libraries/main.js',
    output: {
        path: __dirname + '/public/libraries',
        publicPath: '/libraries/',
        filename: 'bundle.js'
    }

}