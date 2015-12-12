# Signed Service Workers

<p align="center">
  <img src="https://i.imgur.com/hFTheP0.png" alt="Service Worker + ECDSA Signature + Insecure Update Detection (and optional improved secure update) = Signed Service Worker"/>
</p>

[Simple demo](https://qgustavor.github.io/signed-service-workers/) (just shows if the service worker is working and adds security to [this service worker](https://gist.github.com/adactio/4d588bb8a65fa11a3ea3))

**Warning!** Currently it's just an experiment. Using it on prodution can lock-in your application and/or scare out your users.

## Objective:

Improve Service Worker security inspired on [browser extensions](https://developer.chrome.com/extensions/packaging)
and [apps](https://developer.android.com/tools/publishing/app-signing.html), protecting returning visitors from
attacks where server or domain credentials got stolen but code private keys are still safe.

In the case where the loaded worker generates auditable pages and checks hashes/signatures from loaded
content it's intended to be almost safe as an extension based application. As it will work based only
on standards it will not require any specific browser (just one which implemented those standards) and
will not need to follow rules or guidelines from any store.

## How to use:

1. The website needs to already be using service workers. If it's not check [those samples](https://github.com/GoogleChrome/samples/tree/gh-pages/service-worker) to get started;

2. Instead of registering your current service worker with `navigator.serviceWorker.register` 
   register the "loader.js";
3. Edit the loader with those changes:
    * Change the public key to yours. It's an ECDSA P-384 key, [JWK](https://tools.ietf.org/html/rfc7517)
      formatted. The signing tool (dev/sign-file.html) can generate one;
    * Adapt the error messages to your case (maybe translate those too); 
      They're marked with "localization" next to it;
4. Sign the service worker you want to use with the signing tool and save 
    as "sw.js" (or change the location in the `FILENAME` constant);

## How it works:

1. The loader, when installed, will fetch the service worker;
2. The authenticity of the loader is checked using ECDSA (via WebCrypto);
3. If something goes wrong an error message is shown, otherwise the service 
   worker is evaluated;
4. The loader intercept `fetch` events and append an snippet to HTML responses 
   that will show an error message if the service worker gets updated (the
   `updatefound` event);
5. The fetched service worker is cached for an week.

## Alternative Service Worker updating:

By default it will use `fetch` to load the service worker, loading it via HTTPS, then caching it in 
IndexedDB for one week. If wanted the loaded service worker can update
itself, updating the `sw-binary` database, even using other methods beside HTTPS. One example is
WebTorrent, which, even if don't work inside Service Workers,
can be run in the loaded page and update the service worker safety.

The loader script can't be updated natively, as the web platform don't
support native script signing and verification. Instead the loaded service worker
can register other service worker overwriting the existent one and immediately reload
in order to avoid the warnings.

## Compatibility:

Currently the only tested browser that is compatible is Google Chrome. Firefox isn't
compatible yet because WebCrypto isn't enabled in workers ([bug](https://bugzilla.mozilla.org/show_bug.cgi?id=842818])),
what can be fixed with a polyfill, which, for simplicity, isn't going to be released in this repository.
It also may not work with proxies which minify JavaScript files (of course it's not going to work with proxies which
rewrite or add JavaScript as it's insecure). Code is written in ES6, so maybe using some ES6 JavaScript compiler may
be necessary (although if some browser support Service Workers it's possible that it already supports ES6).

## Debug mode:

An debug mode can be enabled if the loader is visited from the `https://unsafe-website.do-not-trust:8000`
origin, even if browsers allow service workers in `http://localhost`. The reason for that is the first
is used for disabling cache and signature verification and the second is used for tests which require
those two features enabled. A minimal node based server and self-signed certificate for testing are provided.
