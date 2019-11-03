function oscar_toggle(editor){
  var comps = editor.DomComponents;

// Adding type
comps.addType('toggle', {
  // Make the editor understand when to bind `my-input-type
  //isComponent reads HTML and transforms into model
  isComponent: el => el.tagName === 'LABEL',

  // Model definition
  model: {
    // Default properties
    defaults: {
      tagName: 'toggle',
      droppable: true,
      resizable: true,
      // // Traits (Settings)
      ip : 'localhost',
      port: 10000,
      message: '/toggle1',
      max: '1',
      toggle: false,
      traits: [ 
      {type: 'text',
      label: 'Ip',
      name: 'ip',
      changeProp: 1,}, 
      {type: 'text',
      label: 'Port',
      name: 'port',
      changeProp: 1,},      
      {type: 'text',
      label: 'Message',
      name: 'message',
      changeProp: 1,},
      {type: 'text',
      label: 'Max',
      name: 'max',
      changeProp: 1,}
      ],
    },
  },
  view: {
    // Bind events
  },
});

//Add to Block Manager
editor.BlockManager.add('toggle', {
  label: 'Toggle',
  attributes: { class:'fa fa-toggle-on'},
  category: 'Basic',
  content: '<label type="text" class="switch"> <input type="checkbox"><span class="slider"></span></label>'
})
}

