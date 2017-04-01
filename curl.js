
/**
 *  Face it, your fingers "just know" how to make cUrl do what you want.
 */
var sg            = require('sgsg');
var _             = require('underscore');
var spawn         = require('child_process').spawn;

var lib           = {};

/**
 *
 *  Pass in 'echo' to run echo, instead of curl
 */
lib.Curl = function(options_) {
  var self = this;

  var options = options_        || {};
  var bincurl = options.bincurl || 'curl';

  var jobAttrs = {};

  self.analyzeArgs = function(args) {
    var params = {args:[]};
    var url;

    var setArg = function(value, msg) {
      if (sg.verbosity() > 2) { console.log((msg || '')+'arg: '+value); }
      params.args.push(''+value);
    }

    var setJobAttr = function(name, value) {
      if (sg.verbosity() > 2) { console.log('jobAttr-'+name+': '+value); }
      jobAttrs[name] = value;
    }

    var analyzeOneArg = function(arg, name) {

      if (arguments.length === 1 && _.isString(arg) && arg.substr(0, 2) === '--') {
        // We cannot send our args to curl
        if (arg.match(/verbose$/)) { return; }

        setArg(''+arg, 'b');
        return;
      }

      if (arguments.length === 1 && _.isString(arg) && arg[0] === '-') {
        setArg(''+arg, 'a');

        if (arg.indexOf('v') !== -1) { setJobAttr('userVerbose'    ,true); }
        if (arg.indexOf('s') !== -1) { setJobAttr('silent'         ,true); }
        if (arg.indexOf('k') !== -1) { setJobAttr('insecure'       ,true); }
        if (arg.indexOf('L') !== -1) { setJobAttr('followLocation' ,true); }

        return;
      }

      if (arguments.length === 1 && _.isString(arg)) {
        // Could be the URL
        if (arg.startsWith('http://') || arg.startsWith('https://')) {
          url = arg;
          return;
        } else {
          return setArg(arg, 'c');
        }
      }

      if (arg === true && _.isString(name)) {
        setArg('--'+name.replace(/[^a-z0-9]/i, '-'), 'd');
        return;
      }
    };

    _.each(args, function(arg) {
      if (sg.verbosity() > 2) { console.log('looking at arg: |'+arg+'|'); }

      if (_.isString(arg))    {
        if (arg.length === 0) { return; }
        return analyzeOneArg(arg);
      }

      if (_.isArray(arg)) {
        return _.each(arg, function(x) {
          return analyzeOneArg(x);
        });
      }

      return _.each(arg, function(x, key) {
        return analyzeOneArg(x, key);
      });
    });

    // Fixups
    if (!jobAttrs.silent)       { setArg('-s', 'Setting silent on behaf of user '); }
    if (!jobAttrs.userVerbose)  { setArg('-v', 'Setting verbose on behaf of user '); }

    jobAttrs.url = params.url = url;
    return params;
  };

  self.curl = function() {

    return function(/*cmdLineArgs, url, callback*/) {
      var params    = Array.prototype.slice.apply(arguments);
      var callback  = params.pop();
      var params    = self.analyzeArgs(_.flatten(params));
      var url       = sg.extract(params, 'url');
      var args      = params.args;

      //var args      = (params[0] || []).concat(['-s']);

      return doCurl(args, url);
      function doCurl(args_, url) {
        var curl, chunks = [], errChunks = [];

        var args = args_.concat([url]);
        if (sg.verbosity() > 0) {
          //console.log(bincurl, args);
          console.log(bincurl+'  '+ _.map(args, function(arg) { return '"'+arg+'"' }).join(' '));
        }

        curl = spawn(bincurl, args);

        curl.stdout.on('data', function(chunk) {
          if (sg.verbosity() > 1) { console.log(''+chunk); }

          chunks.push(chunk);
        });

        var diag = new StderrLineProcessor();
        var remainder = '';
        curl.stderr.on('data', function(chunk) {

          // Some of the lines are separated by '\n', but the ones for the headers are, of course '\r\n'
          var lines = _.reduce((remainder + chunk).split('\r\n'), function(m, str) {
            return m.concat(str.split('\n'));
          },[]);

          remainder = lines.pop();
          diag.processLines(lines);

          errChunks.push(chunk);
        });

        curl.on('close', function(code) {
          var err;

          if (code !== 0 || diag.errors.length > 0) {
            err = new Error('Exit code '+code);
            if (diag.errors.length > 0) {
              err.errors = Array.prototype.slice.apply(diag.errors);
            }
          }

          if (err) { return callback(err); }

          var body, bodyStr = chunks.join('');
          try {
            if (bincurl === 'curl') {
              body = JSON.parse(bodyStr || '{}');
            } else {
              body = {result: bodyStr};
            }
          } catch(e) {
            console.error(e);
            console.error('body: |'+bodyStr+'|');
            return callback(new Error('Failed to parse json'));
          }

          return callback(null, body, {}, code, bodyStr);
        });
      }
    };
  };

  var StderrLineProcessor = function() {
    var self = this;

    self.errors = [];

    var firstLine;
    self.processLines = function(lines) {
      _.each(lines, function(line_, num) {
        var logged;
        var line = line_;

        if (!logged && sg.verbosity() >= 2)    { console.error('LINENUM:'+num+': |'+line+'|', line.length); logged = true; }
        if (!logged && jobAttrs.userVerbose)   { console.error(line);                                       logged = true; }

        if (num === 0) {
          firstLine = line;
        }

        if (line.length <= 1) {
          console.error('Warning: do not understand this line: ', '|'+line+'|', line.length, num);
        }

        var lineOk, symbol = line[0];
        line = line.substr(2);
        switch(symbol) {
          case '*':
            if (line.match(/ssl certificate problem/i)) {
              self.errors.push(line);
            }

            lineOk = true;
            break;

          case '<':
            lineOk = true;
            break;

          case '>':
            lineOk = true;
            break;

          case '{':
            lineOk = true;
            break;

          case '}':
            lineOk = true;
            break;

          default:
            if (symbol === ' ' && num !== 0) {
              if (line.match(/CA(file|path)/i) && firstLine.match(/set certificate/i)) {
                lineOk = true;
              }
            }
            break;
        }

        if (!lineOk) {
          console.error('Warning: do not understand this line: ', '|'+symbol+' '+line+'|', line.length, num);
        }

      });
    };
  };

};

_.each(lib, function(value, key) {
  exports[key] = value;
});

