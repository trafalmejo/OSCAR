/* Loaded by the editor after its own scripts. ready() runs this once the editor is up. */
window.OSCAR.ready(function (oscar) {
  "use strict";
  if (oscar.api !== 1) return;

  oscar.addToolbarButton({
    id: "sample-hello",
    title: "Sample extension",
    // mdi-puzzle, @mdi/svg 7.4.47 (Apache-2.0)
    iconPath:
      "M20.5,11H19V7C19,5.89 18.1,5 17,5H13V3.5A2.5,2.5 0 0,0 10.5,1A2.5,2.5 0 0,0 8,3.5V5H4A2,2 0 0,0 2,7V10.8H3.5C5,10.8 6.2,12 6.2,13.5C6.2,15 5,16.2 3.5,16.2H2V20A2,2 0 0,0 4,22H7.8V20.5C7.8,19 9,17.8 10.5,17.8C12,17.8 13.2,19 13.2,20.5V22H17A2,2 0 0,0 19,20V16H20.5A2.5,2.5 0 0,0 23,13.5A2.5,2.5 0 0,0 20.5,11Z",
    run: function () {
      var box = document.createElement("div");
      box.style.padding = "8px 4px";
      box.textContent = "Asking the server...";
      oscar.openModal("Sample extension", box);
      fetch("x/sample/hello")
        .then(function (res) { return res.json(); })
        .then(function (body) { box.textContent = body.hello + " (OSCAR " + body.oscar + ")"; })
        .catch(function () { box.textContent = "The server did not answer."; });
    },
  });
});
