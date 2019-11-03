function socket(editor){//Client is going to connect to Server
editor.socket = io.connect('http://' + config.ip + ':8081', { port: 8081, rememberTransport: false });
console.log("Client connected to: ", config.ip);
}