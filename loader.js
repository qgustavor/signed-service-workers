/*
 *   The Signed File Loader That Prevents Itself From Being Disabled
 *                  -- take that other "secure" file loaders
 */
'use strict';

// Debug mode requires to use a self-signed certificate
// (no CA will sign a certificate for that impossible domain)
// You can use any static web server for testing it

// Reason: make difficult for a average user to enable it
// Effects: skips signature checking and enable auto-reloading
// The chosen name is to warn the user even if the certificate is trusted
// Using port 8000 instead of 666 because many malware use it
const DEBUG_MODE = location.origin === 'https://unsafe-website.do-not-trust:8000';

// Hard coded variables:
const FILENAME = 'sw.js';
const WEBSITE_NAME = 'Signed Service Workers'; /* the name may need localization */

// The HTML comments prevent an unclosed HTML comment disabling this snippet:
const CHECK_PROBLEMS_SNIPPET = '<!-- Alert user when Service Worker updates without cryptographic verification -->\n<script>(' + handleProblems + '())</script>';
const GENERIC_HEADER = `<!DOCTYPE html>
<html lang=en>
<meta charset=utf-8>
<meta name=viewport content="initial-scale=1, minimum-scale=1, width=device-width">
<title>${WEBSITE_NAME}</title>
${CHECK_PROBLEMS_SNIPPET}`;

// Error styles are based on Google error pages:
// Would be great if someone improves that...
const ERROR_STYLES = `<style>
  *{margin:0;padding:0}
  html{font:15px/22px sans-serif;background:#FF9800;color:#222;padding:15px}
  body{background:#FFF;margin:7% auto;max-width:600px;padding:30px;border-radius:3px}
  p{margin:11px 0 22px}
  strong{color:#111}
</style>`;

/* those messages may need localization */
const HOW_TO_FIX = ' make sure your computer, browser and connection are working properly and that proxies are not being used (which are not supported). If this application has to be used on a network that requires proxies find and download the offline version of this application.<p>Also consider the site to be in trouble: open the page in incognito window and if the website has been compromised look for additional instructions on social networks.<p>You can look for the website name, official accounts or use this generated hashtag #sw' + (Date.now() / 7e7 | 0).toString(36);

const SCRIPT_FAIL_MESSAGE = GENERIC_HEADER + ERROR_STYLES + '<h1>Script error :(</h1><p>This error should never have happened. Look for help and if the problem persists force reload or clean the cache. It is quite insecure but sadly is the only thing that can be done.';

const SOFT_FAIL_MESSAGE = GENERIC_HEADER + ERROR_STYLES  + '<h1>Error loading the page</h1><p>This <strong>may have been caused</strong> for the cleaning of cookies, either manually or automatically. <p>If you suspect that this is not the problem' + HOW_TO_FIX;

const HARD_FAIL_MESSAGE = GENERIC_HEADER + ERROR_STYLES  + '<style>html{background:#8B0920}</style><h1>Security error</h1><p>Maybe <strong>some extension or proxy</strong> tried to change this website.<p>Is recommended to' + HOW_TO_FIX;
/* / those messages may need localization */

const STATES_ENUM = {
  LOADING: 0,
  SCRIPT_LOADED: 1,
  SOFT_FAIL: 2,
  HARD_FAIL: 3,
  SCRIPT_FAIL: 4
};

const PUBLIC_KEY_PROMISE = crypto.subtle.importKey('jwk',
  // The public key NEEDS to be changed, otherwise it will not work
  {crv: 'P-384', ext: true, key_ops:['verify'], kty : 'EC',
  x: 'f_sk32qcccaM-_dQwBLBfG--_HmmcayK4zRV8mF_BoLNnIAKUImnlBOlPLteBUhn',
  y: '2CsW_CSFnZA5BvDghFmZvTOwicbFujQxv2ZrW1fNWV_U6-72Y1IAFFks2ty4y13a'},
  { name: 'ECDSA', namedCurve: 'P-384' }, false, ['verify']
);

let state, pendingPromises, cachedScript, cachedMetadata, fetchHandler, snippetHash;
const addListener = self.addEventListener.bind(self);

// Initialize:
init();

function init() {
  // Initialize variables:
  resetState();
  addServiceWorkerListeners();
  replaceListeners();
  
  // Load cached script from IndexedDB:
  let dbRequest = indexedDB.open('sw-binary', 1);
  dbRequest.onsuccess = function (evt){
    let db = evt.target.result;
    if (!db.objectStoreNames.contains('binary')) {
      dbRequest.onerror();
      return;
    }
    let request = db.transaction('binary').objectStore('binary').get(FILENAME);
    request.onerror = dbRequest.onerror;
    request.onsuccess = function(event) {
      let result = event.target.result;
      if (!result) {
        dbRequest.onerror();
        return;
      }
      checkValidity(result['contents']).then(function(isValid) {
        state = isValid ? STATES_ENUM.SCRIPT_LOADED : STATES_ENUM.HARD_FAIL;

        if (isValid) {
          runCode(result['contents']);
          
          // Do auto-update at least every week:
          // Also update when it was checked on the future
          // because some of our users can be time travelers
          let lastChecked = new Date(result['downloadedTime']).getTime();
          if (lastChecked + 6048e5 < Date.now() || lastChecked > Date.now()) {
            fetchViaHttp(result['updatedTime']);
          }
        }

        handleCallbacks();
      });
    };
  };

  // Handle cases where the DB version was changed or if it`s not created:
  dbRequest.onerror = dbRequest.onupgradeneeded = function () {
    // Disable success handler:
    dbRequest.onsuccess = null;
    fetchViaHttp();
  };
  
  // Calculate snippet SHA-256 hash, for CSP:
  crypto.subtle.digest({ name: 'SHA-256' }, new Uint8Array(
    ('(' + handleProblems + '())').split('').map(e => e.charCodeAt(0))
  )).then(function (hash) {
    snippetHash = btoa(String.fromCharCode.apply(null, new Uint8Array(hash)));
  });
}

// Reset state (on init and generally after a time out)
function resetState() {
  state = STATES_ENUM.LOADING;
  pendingPromises = [];
  fetchHandler = [];
  cachedScript = '';
  cachedMetadata = [];
}

/* Helper function used for converting UTF-8 to Uint8Array */
function decodeUTF8(s) {
  var i, d = unescape(encodeURIComponent(s)), b = new Uint8Array(d.length);
  for (i = 0; i < d.length; i++) {b[i] = d.charCodeAt(i);}
  return b;
}

/* Helper function used for converting Base64 to Uint8Array */
function decodeBase64(s) {
  var i, d = atob(s), b = new Uint8Array(d.length);
  for (i = 0; i < d.length; i++) b[i] = d.charCodeAt(i);
  return b;
}

/* Checks the signature from a signed file */
function checkValidity(result, minModDate) {
  if (DEBUG_MODE) {
    return Promise.resolve(true);
  }

  if (typeof result !== 'string') {
    return Promise.resolve(false);
  }

  return PUBLIC_KEY_PROMISE.then(function (publicKey) {
    // Check for an array of strings in the start of file followed for an semicolon:
    // Note: because this simplified regular expression strings can't contain quotes
    let metadata = result.match(/^(\["[^"]*"(,"[^"]*")*\]);/);
    
    // Remove metadata from result into data:
    let data = result.replace(metadata[0], '');

    // Parse JSON:
    metadata = JSON.parse(metadata[1]);

    // Name, modification date and signature are required, other entries are optional
    // And can be used to store release info, change logs, among other data
    // [name, modification date, ..., signature]

    if (!metadata || !Array.isArray(metadata) || metadata.length < 3) {
      return Promise.resolve(false);
    }

    // Check modification date and file name:
    if (metadata[0] !== FILENAME || metadata[1] <= minModDate) {
      return Promise.resolve(false);
    }

    var signature = metadata.pop();

    return crypto.subtle.verify({
        name: 'ECDSA',
        hash: {name: 'SHA-512'},
      },
      publicKey,
      decodeBase64(signature).buffer,
      decodeUTF8(JSON.stringify(metadata) + ';' + data).buffer
    ).then(function (isValid) {
      if (isValid) {
        cachedMetadata = metadata;
      }
      return isValid;
    });
  }).catch(function(){
    // Encoding errors and others resolve to false
    return Promise.resolve(false);
  });
}


function fetchViaHttp(minimalVersion) {
  // Fetch new code:
  return fetch(FILENAME).then((response) => {
    if (response.ok) {
      return response.text();
    } else { // file not found
      state = STATES_ENUM.HARD_FAIL;
      handleCallbacks();
    }
  }, () => { // network error
    if (state === STATES_ENUM.LOADING) {
      state = STATES_ENUM.SOFT_FAIL;
      handleCallbacks();
      setTimeout(resetState, 5000);
    }
  }).then((code) => {
    if (state === STATES_ENUM.LOADING || state === STATES_ENUM.SCRIPT_LOADED) {
      checkValidity(code).then(function (isValid) {
        if (isValid) {
          // Replace any existent database:
          var request = indexedDB.deleteDatabase('sw-binary');

          // Store script and run it:
          runCode(code);

          // Deleting or not save code:
          request.onerror = request.onsuccess = saveCodeInDatabase;
        }

        if (state === STATES_ENUM.LOADING) {
          state = isValid ? STATES_ENUM.SCRIPT_LOADED : STATES_ENUM.HARD_FAIL;
          handleCallbacks();
        }
      });
    }
  });
}

function saveCodeInDatabase () {
  var request = indexedDB.open('sw-binary', 1);

  request.onupgradeneeded = function(e) {
    var store = e.target.result.createObjectStore('binary', {keyPath: 'filename'});
    store.createIndex('binary', 'binary', {unique: true});

    // downloadedTime needs to be updated if it's updated
    // in other way than HTTP (P2P or manually) in order
    // to prevent the automatic weekly update
    store.add({
      'filename': FILENAME,
      'contents': cachedScript,
      'updatedTime': cachedMetadata[1],
      'downloadedTime': new Date().toISOString()
    });
  };
}

function runCode(code) {
  // Even if we just validated the signature...
  // ... IT'S STILL EVIL! (笑)
  try {
    eval(cachedScript = code);
  } catch(e) {
    console.error('[Loader]', e.message);
    state = STATES_ENUM.SCRIPT_FAIL;
  }
}

function addServiceWorkerListeners() {
  // Service Worker functions:
  addListener('install', function (event) {
    // Who said Service Workers are just for caching things?
    if (event.respondWith) {
      // Check if window.crypto is defined
      // Currently undefined in Firefox for some reason
      let response = window.crypto ?
        fetchViaHttp() :
        Promise.reject();
        
      event.respondWith(response);
    }
  });

  addListener('fetch', function(event) {
    // Always reload when debugging:
    if (DEBUG_MODE) {
      state = STATES_ENUM.LOADING;
      fetchViaHttp();
    }
    event.respondWith(Promise.race([
      new Promise((resolve) => {
        pendingPromises.push({event, resolve});
        if (state !== STATES_ENUM.LOADING) {
          handleCallbacks();
        }
      }),
      new Promise(function (resolve, reject) {
        setTimeout(reject, 5e3);
      })
    ]).catch((err) => {
      console.error('[Loader]', err);
      return generateScriptErrorResponse();
    }));
  });
}

function replaceListeners() {
  self.addEventListener = modifiedEventListener;
  Object.defineProperty(self, 'onfetch', {
    enumerable: true,
    configurable: true,
    get: function () {
      return fetchHandler || null;
    },
    set: function (callback) {
      fetchHandler = callback;
    }
  });
}

function modifiedEventListener(event, callback) {
  if (typeof event != 'string') throw Error("Event isn't string");
  switch (event.toLowerCase()) {
    case 'fetch':
      fetchHandler = callback;
      break;
    case 'install':
    case 'activate':
      callback({
        waitUntil: function (e) {
          return Promise.resolve(e);
        }
      });
      break;
    default:
    addListener.apply(self, arguments);
  }
}

function generateScriptErrorResponse() {
  return new Response(new Blob([SCRIPT_FAIL_MESSAGE], {type: 'text/html; charset=UTF-8'}), {
    status: 503,
    statusText: 'Internal Server Error'
  });
}

function handleCallbacks () {
  pendingPromises.forEach(function (promise) {
    if (promise.done) {return;}
    promise.done = true;

    switch (state) {
      case STATES_ENUM.SCRIPT_FAIL:
      promise.resolve(generateScriptErrorResponse());
      break;

      case STATES_ENUM.SOFT_FAIL:
      promise.resolve(new Response(new Blob([SOFT_FAIL_MESSAGE], {type: 'text/html; charset=UTF-8'}), {
        status: 503,
        statusText: 'Service Unavailable'
      }));
      break;

      case STATES_ENUM.SCRIPT_LOADED:
      let handlerResponse = new Promise(function (resolve, reject) {
        promise.event.respondWith = function (result) {
          Promise.resolve(result).then(resolve, reject);
        };
        fetchHandler(promise.event);
      });
      let originalResponse;
      promise.resolve(
        handlerResponse
        .then(data => {
          // Normalize response:
          originalResponse = data instanceof Response ? data : new Response(data);
          return originalResponse.text();
        }).then(result => {
          // Build headers object
          let headers = {};
          originalResponse.headers.forEach((value, key) => {
            headers[key] = value;
          });

          // He are working on content-type, so don't sniff data:
          headers['x-content-type-options'] = 'nosniff';
          
          // If the requested page is HTML then inject problem handler:
          if (headers['content-type'].indexOf('text/html') !== -1) {
            // Allow the snippet to be run via CSP:
            if (headers['content-security-policy']) {
              headers['content-security-policy'] = headers['content-security-policy']
              .replace(/(^|;)(\s*(?:default|script)-src[^;]*)/gi, "$1$2 'sha256-" + snippetHash + "'")
            }
          
            // Close tags which may prevent script tags from working
            // This RegExp can be used because those tags don't accept any other tag inside
            var FIX_REGEX = /(<((no)?script|textarea|style|title|canvas|picture)\b[^<]*(?:(?!<\/\2>)<[^<]*)*$)/gi;
            while (FIX_REGEX.test(result)) {
              result = result.replace(FIX_REGEX, "$1</$2>");
            }
            
            // problem: it can insert the <script> outside <html> and <body>
            result += CHECK_PROBLEMS_SNIPPET;
          }

          // Clone response in order to allow headers to be changed:
          let response = new Response(result, {
            status: originalResponse.status,
            statusText: originalResponse.statusText,
            headers: headers
          });

          return response;
        })
        .catch(function (err) {
          console.error('[Loader]', err);
          return generateScriptErrorResponse();
        })
      );
      break;

      default:
      promise.resolve(promise.resolve(new Response(new Blob([HARD_FAIL_MESSAGE], {type: 'text/html; charset=UTF-8'}), {
        status: 503,
        statusText: 'Service Unavailable'
      })));
    }
  });

  // Some fast (but weird) way for emptying an array
  // Just JSPerf can explain why
  while(pendingPromises.length){
    pendingPromises.pop();
  }
}

function handleProblems() {
  'use strict'; // injected in generated page
  navigator.serviceWorker.getRegistration().then(function(worker){
    if (worker.waiting){ problemHappened(); }
    worker.onupdatefound = problemHappened;
    worker.active.onstatechange = problemHappened;
  });

  try {
    ['updatefound', 'controllerchange'].forEach(function(evt){
      navigator.serviceWorker.addEventListener(evt, problemHappened);
      navigator.serviceWorker.controller.addEventListener(evt, problemHappened);
    });
  } catch(e){}

  let alreadyHandled = false;

  function problemHappened(){
    if(alreadyHandled) {return;}
    alreadyHandled = true;

    // Just a simple changing hashtag in order to try avoid censoring:
    let hash = (Date.now() / 7e7 | 0).toString(34);
    
    /* ----- this message may need localization ----- */
    let title = 'Failure in the application security';
    let message = '\nThe unexpected change of the file responsible for security at the site was detected and, if there wasn\'t any warning about it, it usually that means the site or even that computer was hacked.\n\nThis warning is being shown in all open tabs, therefore be sure to follow these instructions:\n\n1. DO NOT reload the page, do not force the reload and neither clear the cache.\n2. Try to find what happened searching in social networks and search websites.\n3. If you don\'t find information use those generated hashtags #sw' + hash + ' and #sw' + (Date.now() / 8e7 | 0).toString(36) + '\n4. Make sure your computer has been hacked looking for viruses, trojans, malicious extensions or malicious proxies using the tools designed for that. If you do not have these tools prefer to look for them on another device.\n5. This error message will keep being displayed while the original security file is active and usually will be automatically disabled when the open tabs are closed.';

    // Wait a random time to avoid multiple messages at the same time
    setTimeout(function () {
      // try/catch to avoid local storage errors
      try {
        if (!localStorage[hash]) {
          alert(title + '\n' + message);
          localStorage[hash] = true;
        }
      } catch(e){ alert(title + '\n' + message); }
    }, Math.random() * 4e3);

    (function ensureloop() {
      setTimeout(ensureloop, 10e3);
      document.head.innerHTML = '';
      /* ----- the title may need localization ----- */
      document.title = 'Error!';
      document.body.innerHTML = `<style>
        *{margin:0;padding:0} html{font:15px/22px sans-serif;background:#8B0920;color:#222;padding:15px}
        body{background:#FFF;margin:7% auto;max-width:600px;padding:30px;border-radius:3px;white-space:pre-wrap}
      </style><h2>${title}</h2>${message}`;
    }());
  }
}
