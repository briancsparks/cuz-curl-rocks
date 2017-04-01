
var test        = require('ava');

var libCurl     = require('../curl');
var Curl        = libCurl.Curl;

test('You can get the curl function', function(t) {
  var Curl        = libCurl.Curl;

  var curler  = new Curl({bincurl:'echo'});
  var curl    = curler.curl();

  t.is(typeof curl, 'function');
});

test.cb('You can call the curl function', function(t) {

  var curler  = new Curl({bincurl:'echo'});
  var curl    = curler.curl();

  t.plan(2);
  return curl('http://api.example.com/route', function(err, body) {
    t.falsy(err);
    t.is(typeof body, 'object');
    t.end();
  });
});

