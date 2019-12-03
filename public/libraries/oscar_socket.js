function oscar_socket(editor){//Client is going to connect to Server
 var ipServer = "";
//     $.get("/ipserver", function(data, textStatus, jqXHR){
//         ipServer = data; 
//     })

fetch('http://localhost:8080/ipserver')
  .then(function(response) {
    return response.text();
  })
  .then(function(text) {
    console.log('Request successful', text);
    ipServer = text;
    editor.socket = io.connect('http://' + ipServer + ':8081', { port: 8081, rememberTransport: false });
  })
  .catch(function(error) {
    console.log('Request failed', error)
  });
// editor.socket = io.connect('http://' + ipServer + ':8081', { port: 8081, rememberTransport: false });
}