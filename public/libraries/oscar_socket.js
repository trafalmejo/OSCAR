function oscar_socket(editor){//Client is going to connect to Server
var ipServer = "";
    $.get("/ipserver", function(data, textStatus, jqXHR){
        ipServer = data; 
    })
editor.socket = io.connect('http://' + ipServer + ':8081', { port: 8081, rememberTransport: false });
console.log("Client connected to: ", ipServer);
}