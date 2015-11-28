///////////////////////////////
// Simple Static Node Server //
///////////////////////////////

var useHttp = process.argv.indexOf('--http') !== -1,
    http = require('http'),
    https = require('https'),
    url = require('url'),
    path = require('path'),
    fs = require('fs'),
    contentTypes = {
      '.html': 'text/html; charset=UTF-8',
      '.js': 'application/javascript; charset=UTF-8'
    };
    
if (useHttp) {
  http.createServer(handler).listen(8000, '127.0.0.1');
  console.log('Static file server running at\n  => http://localhost:8000/\nCTRL + C to shutdown');
} else {
  https.createServer({
    pfx: fs.readFileSync('certificate.pfx')
  }, handler).listen(8000, '127.0.0.1');
  console.log('Static file server running at\n  => https://unsafe-website.do-not-trust:8000/\nCTRL + C to shutdown');
}
    
function handler(request, response) {
  var uri = url.parse(request.url).pathname,
      filename = path.join(process.cwd() + '/../', uri);
      
  fs.exists(filename, function (exists) {
    if (!exists) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('404 Not Found\n');
      return;
    }
    if (fs.statSync(filename).isDirectory()) {
      filename += '/index.html';
    }
    // figure out MIME type by file ext
    var contentType = contentTypes[path.extname(filename)] || 'text/plain';
    fs.readFile(filename, 'utf-8', function (err, file) {
      if (err) {
        response.writeHead(500, { 'Content-Type': contentType });
        response.end(err + '\n');
        return;
      }
      response.writeHead(200, { 'Content-Type': contentType });
      response.end(file);
    });
  });
}