'use strict';

// Based on this gist: https://gist.github.com/adactio/4d588bb8a65fa11a3ea3
// Modified to add support to Sub Resource Integrity
// (which got commented as it crashes Chrome)

// Licensed under a CC0 1.0 Universal (CC0 1.0) Public Domain Dedication
// http://creativecommons.org/publicdomain/zero/1.0/

(function() {

  // A cache for core files like CSS and JavaScript
  var staticCacheName = 'static';
  // A cache for pages to store for offline
  var pagesCacheName = 'pages';
  // A cache for images to store for offline
  var imagesCacheName = 'images';
  // Update 'version' if you need to refresh the caches
  var version = 'v1::';

  // Store core files in a cache (including a page to display when offline)
  var updateStaticCache = function() {
    return caches.open(version + staticCacheName)
      .then(function (cache) {
        return Promise.all([
          ['./', 'sha384-u9BAMP1sRSpR8btg2/dR0qap7cR6w/an1CePpiYzyNZqB3LBRYfPHYi484Mhal/z'],
          ['./offline.html', 'sha384-N/wI+5HnbD7MQ5MvgKp27mlXuaUXkxdyMP0Z/YcuKKrvcA/6FFWupYFFAmmE1gRY']
        ].map(function (requestData) {
          var request = new Request(requestData[0]);
          
          return fetch(request.clone(), {
            // Uncommenting the below line crashes Chrome 49.0.2577.0
            // Hash verification needs to be implemented in other way :(
            // integrity: requestData[1]
          }).then(function (response) {
            return cache.put(request, response);
          });
        }));
      });
  };

  // Keep items in a cache to a specified number by deleting the oldest item
  var stashInCache = function(cacheName, maxItems, request, response) {
    caches.open(cacheName)
      .then(function (cache) {
        cache.keys()
          .then(function (keys) {
            if (keys.length < maxItems) {
              cache.put(request, response);
            } else {
              cache.delete(keys[0])
                .then(function() {
                  cache.put(request, response);
                });
            }
          })
      });
  };

  // Remove caches whose name is no longer valid
  var clearOldCaches = function() {
    return caches.keys()
      .then(function (keys) {
        return Promise.all(keys
          .filter(function (key) {
            return key.indexOf(version) !== 0;
          })
          .map(function (key) {
            return caches.delete(key);
          })
        );
      })
  };

  self.addEventListener('install', function (event) {
    event.waitUntil(updateStaticCache()
      .then(function () {
        return self.skipWaiting();
      })
    );
  });

  self.addEventListener('activate', function (event) {
    event.waitUntil(clearOldCaches()
      .then(function () {
        return self.clients.claim();
      })
    );
  });

  self.addEventListener('fetch', function (event) {
    var request = event.request;
    // For non-GET requests, try the network first, fall back to the offline page
    if (request.method !== 'GET') {
      event.respondWith(
        fetch(request)
          .catch(function () {
            return caches.match('/offline.html');
          })
      );
      return;
    }

    // For HTML requests, try the network first, fall back to the cache, finally the offline page
    if (request.headers.get('Accept').indexOf('text/html') !== -1) {
      event.respondWith(
        fetch(request)
          .then(function (response) {
            // NETWORK
            // Stash a copy of this page in the pages cache
            var copy = response.clone();
            var cacheName = version + pagesCacheName;
            var maxItems = 35;
            stashInCache(cacheName, maxItems, request, copy);
            return response;
          })
          .catch(function () {
            // CACHE or FALLBACK
            return caches.match(request)
              .then(function (response) {
                return response || caches.match('/offline.html');
              })
          })
      );
      return;
    }

    // For non-HTML requests, look in the cache first, fall back to the network
    event.respondWith(
      caches.match(request)
        .then(function (response) {
          // CACHE
          return response || fetch(request)
            .then(function (response) {
              // NETWORK
              // If the request is for an image, stash a copy of this image in the images cache
              if (request.headers.get('Accept').indexOf('image') !== -1) {
                var copy = response.clone();
                var cacheName = version + imagesCacheName;
                var maxItems = 20;
                stashInCache(cacheName, maxItems, request, copy);
              }
              return response;
            })
            .catch(function () {
              // OFFLINE
              // If the request is for an image, show an offline placeholder
              if (request.headers.get('Accept').indexOf('image') !== -1) {
                return new Response('<svg role="img" aria-labelledby="offline-title" viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg"><title id="offline-title">Offline</title><g fill="none" fill-rule="evenodd"><path fill="#D8D8D8" d="M0 0h400v300H0z"/><text fill="#9B9B9B" font-family="Helvetica Neue,Arial,Helvetica,sans-serif" font-size="72" font-weight="bold"><tspan x="93" y="172">offline</tspan></text></g></svg>', { headers: { 'Content-Type': 'image/svg+xml' }});
              }
            });
        })
    );
  });

})();
