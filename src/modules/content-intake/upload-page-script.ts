/**
 * Vanille JS voor de publieke uploadpagina (geen bundelstap; CSP staat alleen same-origin scripts
 * toe). Doet alleen client-side gemak (bestandslijst, verwijderen vóór verzenden, status tijdens
 * versturen); alle echte validatie gebeurt server-side in upload-service.ts.
 */
export const UPLOAD_PAGE_SCRIPT = `
(function () {
  'use strict';
  var form = document.getElementById('upload-form');
  if (!form) return;
  var input = document.getElementById('files');
  var list = document.getElementById('filelist');
  var status = document.getElementById('form-status');
  var submitBtn = document.getElementById('submit-btn');
  var selected = [];

  function fmtSize(bytes) {
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // Verwijdert index i en zet de focus op een zinvolle plek terug (het lijstitem wordt bij elke
  // wijziging volledig herbouwd, dus de focus zou anders terugvallen op <body>).
  function remove(i) {
    selected.splice(i, 1);
    render();
    var buttons = list.querySelectorAll('button');
    if (buttons.length === 0) {
      input.focus();
    } else {
      var next = Math.min(i, buttons.length - 1);
      buttons[next].focus();
    }
  }

  function render() {
    list.innerHTML = '';
    selected.forEach(function (file, i) {
      var li = document.createElement('li');
      var label = document.createElement('span');
      label.textContent = file.name + ' (' + fmtSize(file.size) + ')';
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-remove';
      removeBtn.textContent = 'Verwijderen';
      removeBtn.setAttribute('aria-label', 'Verwijder ' + file.name);
      removeBtn.addEventListener('click', function () {
        remove(i);
      });
      li.appendChild(label);
      li.appendChild(removeBtn);
      list.appendChild(li);
    });
  }

  input.addEventListener('change', function () {
    var added = input.files.length;
    for (var i = 0; i < input.files.length; i++) selected.push(input.files[i]);
    input.value = '';
    render();
    status.textContent =
      added + (added === 1 ? ' bestand' : ' bestanden') + ' toegevoegd, in totaal ' + selected.length + '.';
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (selected.length === 0) {
      status.textContent = 'Voeg minstens één foto of video toe voordat u verstuurt.';
      input.focus();
      return;
    }
    var data = new FormData(form);
    data.delete('files');
    selected.forEach(function (file) {
      data.append('files', file, file.name);
    });
    submitBtn.disabled = true;
    submitBtn.textContent = 'Bezig met versturen...';
    status.textContent = 'Bezig met versturen, even geduld...';
    fetch(window.location.pathname, { method: 'POST', body: data })
      .then(function (res) {
        return res.text().then(function (html) {
          document.open();
          document.write(html);
          document.close();
          // document.write is geen echte paginanavigatie: schermlezers kondigen de nieuwe inhoud
          // niet vanzelf aan, dus de focus gaat expliciet naar de melding (gelukt/mislukt) of anders
          // de kop, zodat die meteen wordt voorgelezen.
          var target = document.querySelector('.alert, .success') || document.querySelector('h1');
          if (target) {
            target.setAttribute('tabindex', '-1');
            target.focus();
          }
        });
      })
      .catch(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Versturen';
        status.textContent = 'Versturen is mislukt. Controleer de internetverbinding en probeer opnieuw.';
      });
  });
})();
`;
