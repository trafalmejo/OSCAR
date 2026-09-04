/**
 * The OSC bridge routes purely on each widget's own target IP, so the client's
 * own address is not needed. It is still emitted as the first socket argument
 * for compatibility with projects saved by OSCAR 1.x.
 */
function oscar_ip(editor) {
  editor.ip = "localhost";
}
