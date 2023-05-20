Components.utils.import("resource://gre/modules/Communicator.jsm");

function Startup() {
  main = document.getElementById("main");
  let textbox = document.createElement("textbox");
  [
    ["id", "eula"],
    ["readonly", "true"],
    ["multiline", "true"],
    ["cols", "80"],
    ["rows", "20"],
    ["style", "resize: none; font-family: -moz-fixed;"],
    ["value", Communicator.readfile("GreD", "license.txt")]
  ].forEach(([name, value]) => textbox.setAttribute(name, value));
  main.appendChild(textbox);
}

function onAccept() {
  Communicator.service.prefs.setBoolPref("app.eula.accepted", true);
}

function onCancel() {
  Communicator.service.prefs.setBoolPref("app.eula.accepted", false);
  Communicator.service.startup.quit(Communicator.service.startup.eForceQuit);
}

