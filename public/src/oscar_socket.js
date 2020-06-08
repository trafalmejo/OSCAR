function oscar_socket(editor, options){//Client is going to connect to Server
 editor.ipserver = "localhost"
// fetch('/ipserver')
//   .then(function(response) {
//     return response.text();
//   })
//   .then(function(text) {
//     console.log('Request successful', text);
//     ipServer = text;
//     editor.ipserver = ipServer
//     editor.socket = io.connect('http://' + ipServer + ':8081', { port: 8081, rememberTransport: false });
//   })
//   .catch(function(error) {
//     console.log('Request failed', error)
//   });
    editor.ipserver = options.ipserver
    editor.socket = io.connect('http://' + editor.ipserver + ':8081', { port: 8081, rememberTransport: false });
}
