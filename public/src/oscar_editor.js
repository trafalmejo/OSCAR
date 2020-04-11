window.$ = window.jQuery = require('jquery');
var localIPpromise = require('binternalip');
//var localIPpromise = require('./webRTC.js');
var ipLibrary = require('ip');
var editor;
var ipServer = "localhost";

$.get("/ipserver", function (data, status) {
  ipServer = data;
  console.log('/ipserver answered: ', data)
  initGrape();
  //editor as a variable of global Scope
  window.editor = editor;
  //alert("Data: " + data + "\nStatus: " + status);
});

function initGrape() {
  editor = grapesjs.init({
    // domComponents: { storeWrapper: 1 },
    dragMode: 'absolute',
    height: '100%',
    container: '#gjs',
    fromElement: true,
    allowScripts: 1,
    canvas: { styles: ['assets/css/toggle.css'] },
    panels: {
    },
    assetManager: {
      assets: [
        'images/fruits/emoji-apple.png',
        'images/fruits/emoji-apple-click.png',
        'images/fruits/emoji-orange.png',
        'images/fruits/emoji-orange-click.png',
        'images/fruits/emoji-banana.png',
        'images/fruits/emoji-banana-click.png',
        'images/fruits/background.png',
        // Pass an object with your properties
        {
          type: 'image',
          src: 'http://placehold.it/350x250/459ba8/fff/image2.jpg',
          height: 350,
          width: 250
        },
        {
          type: 'image',
          src: 'http://placehold.it/350x250/78c5d6/fff/image1.jpg',
          height: 200,
          width: 200
        },
        {
          // As the 'image' is the base type of assets, omitting it will
          // be set as `image` by default
          src: 'http://placehold.it/350x250/79c267/fff/image3.jpg',
          height: 350,
          width: 250
        },
      ],
    },
    //Just draw on set of style options
    styleManager: {},
    // Configurations for Block Manager
    blockManager: {},
    traitManager: {
    },
    //Persistance
    // Default configurations
    storageManager: {
      id: 'gjs-',             // Prefix identifier that will be used on parameters
      //type: 'local',          // Type of the storage
      //type: null,          // Type of the storage
      type: 'remote',          // Type of the storage
      stepsBeforeSave: 1,     // If autosave enabled, indicates how many changes are necessary before store method is triggered
      urlStore: 'http://' + ipServer + ':8080/store',
      urlLoad: 'http://' + ipServer + ':8080/load',
      autosave: false,         // Store data automatically
      autoload: false,         // Autoload stored data on init
      contentTypeJson: true,
      // For custom parameters/headers on requests
      // params: { _some_token: '....' },
      // headers: { Authorization: 'Basic ...' }, 
      // //Enable/Disable components model (JSON format)
      //storeComponents: 1,
      // //Enable/Disable styles model (JSON format)
      // storeStyles: 1,
      // //Enable/Disable saving HTML template
      // storeHtml: 1,
      // //Enable/Disable saving CSS template
      // storeCss: 1,
    },
    // TO READ: this plugin loads default blocks
    plugins: ['oscar_socket', 'oscar_ip', 'oscar_button', 'oscar_slider', 'gjs-preset-webpage', 'grapesjs-custom-code', 'grapesjs-parser-postcss', 'grapesjs-touch', 'grapesjs-tooltip'],
    pluginsOpts: {
      'oscar_socket': {
        ipserver: ipServer,
      },
      'oscar_slider': {
        ipserver: ipServer,
      },
      'oscar_button': {
        ipserver: ipServer,
      },
      'grapesjs-tooltip': {},
      'gjs-preset-webpage': {
        blocks: [],
        formsOpts: false,
        exportOpts: false,
        navbarOpts: false,
        countdownOpts: false,
        showStylesOnChange: true,
        modalImportTitle: 'Import Template',
        modalImportLabel: '<div style="margin-bottom: 10px; font-size: 13px;">Paste here your HTML/CSS and click Import</div>',
        modalImportContent: function (editor) {
          return editor.getHtml() + '<style>' + editor.getCss() + '</style>'
        }
      },
    }
  });
  //END EDITOR INIT


  //EVENT WHEN THE EDITOR IS LOADED
  editor.on('load', function (edit) {
  });
  //Event is trigger for every loaded component
  editor.on('storage:load', function (editor) {
  });
  editor.on('storage:store', function (editor) {
  });
  editor.on('component:add', function (model) {
  });
  editor.on('component:remove', function (model) {
  });
  //UPDATE TRAITS
  editor.on("component:update", function (component) {
  })


  //FIXES MODAL FOR CUSTOM CODE PLUGIN
  editor.on('run:custom-code:open-modal', () =>
    editor.once('modal:close', () => {
      const { Commands } = editor;
      if (Commands.isActive('custom-code:open-modal')) {
        Commands.stop('custom-code:open-modal');
      }
    }),
  );

  //Turn OFF editable mode on Preview
  editor.on('run:preview', () => {
    // Execute a callback on all inner components starting from the root
    //var res = editor.store(res => console.log('Store callback'));
    editor.DomComponents.getWrapper().onAll(comp =>
      comp.set({ editable: false, draggable: false })
    );
    const domComponents = editor.DomComponents;
    var code = domComponents.getComponents();
    console.log("Components: ", code.models)
    editor.socket.emit('code', code);
  });

  //Turn ON editable mode on Preview
  editor.on('stop:preview', () => {
    // Execute a callback on all inner components starting from the root
    editor.DomComponents.getWrapper().onAll(comp =>
      comp.set({ editable: true, draggable: true })
    );
  });

  //FIXES MODAL FOR IMPORT HTML CODE
  editor.on('run:gjs-open-import-webpage', () =>
    editor.once('modal:close', () => {
      const { Commands } = editor;
      if (Commands.isActive('gjs-open-import-webpage')) {
        Commands.stop('gjs-open-import-webpage');
      }
    }),
  );

  // Add and beautify tooltips
  var pn = editor.Panels;
  var modal = editor.Modal;
  var commands = editor.Commands;

  //Set General MODAL
  function setModal(title, namecontainer, buttonclicked) {
    var mdlClass = 'gjs-mdl-dialog-sm';
    var container = document.getElementById(namecontainer);
    var mdlDialog = document.querySelector('.gjs-mdl-dialog');
    mdlDialog.className += ' ' + mdlClass;
    container.style.display = 'block';
    modal.setTitle(title);
    modal.from = buttonclicked;
    modal.setContent(container);
    modal.open();
    modal.getModel().once('change:open', function () {
      mdlDialog.className = mdlDialog.className.replace(mdlClass, '');
    })
  }

  //FORM LogginIn
  $('#login_button').click(function () {
    console.log("pressed")
    var email = $('#email').val();
    var password = $('#password').val();
    $.ajax({
      type: "POST",
      url: "/login",
      data: { email: email, password: password },
      dataType: 'html'
    })
      .done(function (result) {
        isloggedIn(modal.from +"")
      });
  });

  //FORM LogginOut
  $('#logout-button-load, #logout-button-save').click(function () {
    $.ajax({
      type: "GET",
      url: "/logout",
      dataType: 'html'
    })
      .done(function (result) {
        //setModal('Login', 'login-panel')
        modal.close();

      });
  });

  //Check If user is loggedIn
  function isloggedIn(type) {
    $.get("/loggedin", function (loggedin, status) {
    })
      .done(function (loggedin) {
        //User is not loggedIn
        if (!loggedin) {
          setModal('Login', 'login-panel', type)
        }
        //User is loggedIn
        else {
          if (type == "save") {
            setModal('Save', 'save-panel')
          }
          else if (type == "load") {
            setModal('Load', 'load-panel')
          }
        }
      });
  }


  // Open Modal Command
  var mdlClass = 'gjs-mdl-dialog-sm';
  commands.add('open-modal-login', (editor, sender, options = {}) => {
    //console.log(options.type)
    if (options.type) {
      isloggedIn(options.type)
    }
    var mdlDialog = document.querySelector('.gjs-mdl-dialog');
    mdlDialog.className += ' ' + mdlClass;
    modal.open();
    modal.getModel().once('change:open', function () {
      mdlDialog.className = mdlDialog.className.replace(mdlClass, '');
    })
  }

  );

  //Add Save Panel Button
  pn.addButton('options', {
    id: 'open-save',
    className: 'fa fa-cloud-upload',
    command: function () {
      editor.runCommand('open-modal-login', { type: "save" })
    },
    attributes: {
      'title': 'Save',
      'data-tooltip-pos': 'bottom',
    },
  });
  //Add Load Panel Button
  pn.addButton('options', {
    id: 'open-load',
    className: 'fa fa-cloud-download',
    command: function () {
      editor.runCommand('open-modal-login', { type: "load" })
    },
    attributes: {
      'title': 'Load',
      'data-tooltip-pos': 'bottom',
    },
  });
  //Add About Button
  pn.addButton('options', {
    id: 'open-info',
    className: 'fa fa-question-circle',
    command: function () {
      setModal('About', 'info-panel')
      editor.runCommand('open-modal-login')
    },
    attributes: {
      'title': 'About',
      'data-tooltip-pos': 'bottom',
    },
  });

  editor.on('run:open-modal-login', function () {
    console.log("MODAL OPENED")

  });
  //Save and Load
  const RemoteStorage = editor.StorageManager.get('remote');
  // Save Action
  var saveName = document.getElementById('save-name');
  var saveButton = document.getElementById('save-button');
  saveButton.onclick = () => {
    RemoteStorage.set('params', { name: saveName.value })
    editor.store(res => console.log('Saved'));
  };
  // Load Action
  var loadName = document.getElementById('load-name');
  var loadButton = document.getElementById('load-button');
  loadButton.onclick = () => {
    console.log(loadName.value)
    RemoteStorage.set({ urlLoad: 'http://' + ipServer + ':8080/load/' + loadName.value })
    editor.load();
    // fetch('http://' + ipServer + ':8080/load/'+loadName.value)
    //   .then((response) => {
    //     return response.json();
    //   })
    //   .then((data) => {
    //     //console.log(data);
    //     editor.load(data)
    //   });
  };

  //Create IP Label
  var ipButton = pn.addButton('devices-c', {
    id: 'ipButton',
    className: 'someClass',
    label: "IP: ",
    command: null,
    attributes: { title: 'Server IP' },
    active: false,
    disable: true,
  });


  var IPLabel = pn.getButton('devices-c', 'ipButton');
  getipServer();

  function getipServer() {
    IPLabel.set("label", "Server IP: " + editor.ipserver);
  }

  //Default value of editor.ip is localhost
  editor.ip = "localhost"

  localIPpromise.then((ipAddr) => {
    var ipv4 = "";
    for (let i = 0; i < ipAddr.length; i++) {
      if (ipLibrary.isV4Format(ipAddr[i])) {
        ipv4 = ipAddr[i];
        editor.ip = ipv4;
      }
    }
    if (editor.ip == "" || !ipLibrary.isV4Format(editor.ip)) {
      editor.ip = "localhost"
      //IPLabel.set("label", "Client IP: " + editor.ip);
    }
    console.log('editor.ip: ', editor.ip)

  })
  localIPpromise.catch(error => {
    console.log("Error: ", error);
    editor.ip = "localhost"
    IPLabel.set("label", "IP: " + editor.ip);
  });


  const panelManager = editor.Panels;
  // Add and beautify tooltips
  [['sw-visibility', 'Show Borders'], ['preview', 'Preview'], ['fullscreen', 'Fullscreen'],
  ['export-template', 'See Code'], ['undo', 'Undo'], ['redo', 'Redo'],
  ['gjs-open-import-webpage', 'Import'], ['canvas-clear', 'Clear canvas']]
    .forEach(function (item) {
      pn.getButton('options', item[0]).set('attributes', { title: item[1], 'data-tooltip-pos': 'bottom' });
    });
  [['open-sm', 'Style Manager'], ['open-tm', 'OSC Settings'], ['open-layers', 'Layers'], ['open-blocks', 'Blocks']]
    .forEach(function (item) {
      pn.getButton('views', item[0]).set('attributes', { title: item[1], 'data-tooltip-pos': 'bottom' });
    });
  var titles = document.querySelectorAll('*[title]');
  for (var i = 0; i < titles.length; i++) {
    var el = titles[i];
    var title = el.getAttribute('title');
    title = title ? title.trim() : '';
    if (!title)
      break;
    el.setAttribute('data-tooltip', title);
    el.setAttribute('title', '');
  }
  // Show borders by default
  //pn.getButton('options', 'sw-visibility').set('active', 1);

}
