#!/usr/bin/env node
// jitploy.js ~ CLIENT ~ Copyright 2017 ~ Paul Beaudet MIT License
"use strict";
// Libraries
var path      = require('path');             // native file path parsing module
var fs        = require('fs');               // native filesystem module
var child     = require('child_process');    // run commandline executables
var commander = require('commander');        // help run process as a command line program
var pm2       = require('pm2');              // Process management 2 API and application
var crypto    = require('crypto');           // native crytography module
var yaml      = require('js-yaml');          // primary camel
var ioclient  = require('socket.io-client'); // to connect to our jitploy intergration server

// Constants
var DAEMON_MODE = 'deamon_mode';
var CONFIG_FOLDER = '/jitploy';
var ALGORITHM = 'aes-128-cbc';
var DEMO_ENV = 'sample';

var jitploy = {
    SERVER: 'https://jitploy.deabute.com/',            // Defaults to sass server, you can run your own if you like
    init: function(repoName, server, token, servicePath){
        if(server){jitploy.SERVER = server;}
        jitploy.client = ioclient(jitploy.SERVER);     // jitploy socket server connection initiation
        var repoRequest = {token: token ? token : 0};  // default to public (zero) if no token passed
        if(repoName){
            repoRequest.name = repoName;
            jitploy.firstConnect(repoRequest);
        } else {                                       // given no name was passed default to package.json information
            var packageInfo = require(servicePath + '/package.json');
            if(packageInfo.hasOwnProperty('repository') && packageInfo.repository.hasOwnProperty('url')){
                repoRequest.url = packageInfo.repository.url.split('//')[1];  // split out git+https// or ssh// prefix commonly found
                jitploy.firstConnect(repoRequest);
            } else { console.log('Not enough information to connect to server');}
        }
    },
    firstConnect: function(repoRequest){
        jitploy.client.on('connect', function authenticate(){ // connect with orcastrator
           jitploy.client.emit('authenticate', repoRequest);  // NOTE assumes TLS is in place otherwise this is useless
        });
        jitploy.client.on('deploy', run.deploy);              // respond to deploy events
    }
};

var config = {
    env: DEMO_ENV,                   // Default to demo mode to publically demostrate how service could be run
    decrypt: function(configKey, cwd, onFinish, env){
        if(env){config.env = env;}   // If specified change default env to specified one so that it is called on subsequent deploys
        if(config.env === DEMO_ENV){ // In this case there is a plain text yml file that is an example
            template.atemp(cwd + CONFIG_FOLDER + '/' + DEMO_ENV + '.yml', config.env, onFinish); // try to open a demo or create a template one
        } else if(configKey){        // shared secret aka important part of decrypting something
            fs.stat(cwd + CONFIG_FOLDER + '/encrypted_' + config.env, function onFileCheck(error, stats){
                if(error){
                    console.log(error);
                    onFinish();
                } else if(stats.isFile()){ // if this file exist we have something to read from and a folder to write into
                    var readFile = fs.createReadStream(cwd + CONFIG_FOLDER + '/encrypted_' + config.env);
                    var sharedKey = configKey.substr(0, configKey.length/2);
                    var iv = configKey.substr(configKey.length/2, configKey.length);
                    var decrypt = crypto.createDecipheriv(ALGORITHM,  new Buffer(sharedKey, 'base64'), new Buffer(iv, 'base64'));
                    var writeFile = fs.createWriteStream(cwd + CONFIG_FOLDER + '/decrypted_' + config.env + '.yml');
                    readFile.pipe(decrypt).pipe(writeFile);
                    writeFile.on('finish', function(){
                        fs.readFile(cwd + CONFIG_FOLDER + '/decrypted_' + config.env + '.yml', 'utf8', function(err, data){
                            onFinish(yaml.safeLoad(data));   // pass env vars and call next thing to do
                        });
                    });
                } else {console.log('config: no file or error'); onFinish();}
            });
        } else {onFinish();} // No encrypted config is an option, in this case just pass through
    },
    init: function(dir, env, tempOnly){   // Polymorphic, creates template or encrypts potential changes and additions
        var servicePath = path.resolve(path.dirname(dir));
        var configFile = servicePath + CONFIG_FOLDER + '/' + DEMO_ENV + '.yml';
        if(env){configFile = servicePath + CONFIG_FOLDER + '/decrypted_' + env + '.yml';}
        else {env = DEMO_ENV; tempOnly = true;}                     // no locking in demo case
        fs.mkdir(servicePath + CONFIG_FOLDER, function(mkdirError){ // if dir exist make template, otherwise make dir and template
            if(mkdirError){
                if(mkdirError.code === 'EEXIST'){template.atemp(configFile, env, config.lock(servicePath, env, tempOnly));}
                else {console.log('Error on making directory: ' + mkdirError);}
            } else { // given this is first time configuring, want to exclude decrypted file patterns from version control
                fs.appendFile(servicePath + '/.gitignore', CONFIG_FOLDER.substr(1, CONFIG_FOLDER.length) + '/decrypted_*',
                    function addedToGitignore(appendError){
                        if(appendError){console.log('Failed to exclude decrypted file from git, you might want to manually do that: ' + appendError);}
                        template.atemp(configFile, env, config.lock(servicePath, env, tempOnly)); // Create decrypted file template regardless
                    }
                );
            }
        });
    },
    lock: function(servicePath, env, tempOnly){
        if(tempOnly){ // in case of demo env or template option we only want a decrypted file
            return function(existing){console.log('No encryption needed for ' + env + ' at this time');};
        } else {      // otherwise we want to encrypt an existing file we are pointed at
            return function(existing){
                if(existing){ // give an existing config was found "existing" should be that object
                    if(existing.JITPLOY_SHARED_KEY){
                        var sharedKey = existing.JITPLOY_SHARED_KEY.substr(0, existing.JITPLOY_SHARED_KEY.length/2);
                        var iv = existing.JITPLOY_SHARED_KEY.substr(existing.JITPLOY_SHARED_KEY.length/2, existing.JITPLOY_SHARED_KEY.length);
                        config.encrypt(servicePath, env, sharedKey, iv);
                    } else {console.log('shared key is missing, need it to lock this config');}
                } // else this function may have been called on creation of a template
            };
        }
    },
    encrypt: function(servicePath, env, sharedSecret, iv){ // existance of read file should already be verified
        var readFile = fs.createReadStream(servicePath + CONFIG_FOLDER + '/decrypted_' + env + '.yml');
        var encrypt = crypto.createCipheriv(ALGORITHM, new Buffer(sharedSecret, 'base64'), new Buffer(iv, 'base64'));
        var writeFile = fs.createWriteStream(servicePath + CONFIG_FOLDER + '/encrypted_' + env);
        readFile.pipe(encrypt).pipe(writeFile);
    }
};

var template = {
    create: function(fileData, env, configFile, onExist){
        var sharedSecret = crypto.randomBytes(16).toString('base64') + crypto.randomBytes(16).toString('base64');
        fs.writeFile(fileData,
            '# Add properties to this module in order set configuration for ' + env + ' environment\n' +
            '{\n' +
            '    JITPLOY_SHARED_KEY: \'' + sharedSecret + '\', # Shared key for remote target enviroment, encrypts this file if not demo\n' +
            '    YOUR_ENV_VAR: \'might want to lint your yml\' # Jitploy expects a json like object to transform to enviroment vars\n' +
            '}\n',
            function onWrite(error){
                if(error){console.log('template write error: ' + error);}
                else{
                    console.log('Configuration template made for ' + env + ' at ' + configFile);
                    console.log('Edit this file to add enviroment variables that will be decrypted by a shared key on deployment');
                }
                onExist(); // cause why hold deployment up for errors
            }
        );
    },
    atemp: function(configFile, env, onExist){ // attempts to create a template and locks existing file if thats whats blocking it
        fs.open(configFile, 'wx', function readOrCreate(error, fileData){
            if(error){
                if(error.code === 'EEXIST'){                    // In case where decrypted file exist
                    fs.readFile(configFile, function readTheFile(readErr, data){
                        if(readErr){console.log(readErr);}
                        else{onExist(yaml.safeLoad(data));}
                    });
                } else { console.log('on attempting to work config file: ' + error);}
            } else {
                template.create(fileData, env, configFile, onExist);
            }
        });
    }
};

var daemon = {
    s: [],                                      // Array of daemons being managed by this application (Jitploy itself, apps its listening for)
    onTurnOver: function(error, proccessInfo){  // generic handler for errCallback, see pm2 API
        if(error){console.log(error);}
    },
    deploy: function(service, env){             // what to do on deploy step
        var existing = false;
        for(var proc = 0; proc < daemon.s.length; proc++){
            if(daemon.s[proc] === service){existing = true;}
        }
        if(existing){
            pm2.delete(service, function onStop(error){
                if(error){console.log(error);}
                daemon.startup(service, env, daemon.onTurnOver);
            });
        } else {
            daemon.startup(service, env, daemon.onTurnOver); // given function has yet to exit
        }
    },
    startup: function(service, env, onStart){                // deamonizes pm2 which will run app non interactively
        pm2.connect(function onPM2connect(error){            // This would also connect to an already running deamon if it exist
            if(error){onStart(error);}                       // abstract error handling
            else {
                if(!env){env = {};}                          // given no arguments pass no arguments
                pm2.start({script: service, env: env, logDateFormat:"YYYY-MM-DD HH:mm Z"}, function initStart(err, proc){
                    daemon.s.push(service);                  // add this name to our list of running daemons
                    onStart(err);
                });
            } // after connected with deamon start process in question
        });
    }
};

var run = {
    config: false,                   // default to false in case no can has config deploys assuming static config
    servicePath: false,
    PATH: process.env.PATH,          // makes sure this process knows where node is
    cmd: function(command, cmdName, onSuccess, onFail){
        console.log('Jitploy running:' + command);
        command = 'cd ' + run.servicePath + ' && PATH=' + run.PATH + ' ' + command; // cwd makes sure we are in working directory that we originated from
        run[cmdName] = child.exec(command);
        run[cmdName].stdout.on('data', console.log);
        run[cmdName].stderr.on('data', console.log);
        run[cmdName].on('close', function doneCommand(code){
            if(code){onFail(code);}
            else {onSuccess();}
        });
        run[cmdName].on('error', function(error){console.log('child exec error: ' + error);});
    },
    deploy: function(service, configKey, env, jitployStart){       // runs either on start up or every time jitploy server pings
        if(service){                                               // given this is being called from cli
            run.service = service;
            if(configKey){run.config = configKey;}                 // Set config key, if we have something to decrypt and something to do it with
        }
        run.pull(env, jitployStart);                               // remember we get nothing when server triggers deploy
    },
    pull: function(env, jitployStart){
        run.cmd('git pull', 'gitPull', function pullSuccess(){             // pull new code
            config.decrypt(run.config, run.servicePath, function onConfig(configVars){
                run.install(configVars, jitployStart);
            }, env); // decrypt configuration if it exist then install
        }, function pullFail(code){console.log('no pull? ' + code);});
    },
    install: function(configVars, jitployStart){    // npm install step, reflect package.json changes and probably restart when done
        run.cmd('npm install', 'npmInstall', function installSuccess(){
            daemon.deploy(run.service, configVars); // once npm install is complete restart service
            if(jitployStart){setTimeout(jitployStart, 2000);} // only connect with jitploy server if service successfully launches
        }, function installFail(code){
            console.log('bad install? ' + code);
        });
    }
};

var cli = {
    setup: function(){
        commander
            .version(require('./package.json').version); // grabs currently published version
        commander
            .usage('[options] <file ...>')
            .option('-k, --key <key>', 'key to unlock service config')
            .option('-t, --token <token>', 'config token to use service if private')
            .option('-r, --repo <repo>', 'repo name')
            .option('-s, --server <server>', 'jitploy server to connect to')
            .option('-e, --env <env>', 'unlocks for x enviroment')
            .action(cli.run);
        commander
            .command('lock')
            .usage('[options] <directory ...>')
            .description('encrypts configuration, on templates a decrypted file if its non existent')
            .action(function encryptIt(dir, options){config.init(dir, options.parent.env);});
        commander
            .command('unlock')
            .usage('[options] <directory ...>')
            .action(function decryptIt(dir, options){config.decrypt(options.parent.key, path.resolve(path.dirname(dir)), console.log, options.parent.env);});
        commander
            .command('template')
            .usage('[options] <directory ...>')
            .action(function templateConfig(dir, options){config.init(dir, options.parent.env, true);}); // Pass true for template only option
        commander.parse(process.argv);
        if(commander.args.length === 0){commander.help();}
    },
    run: function(service, options){
        daemon.startup(process.argv[1], {  // Env vars to pass jitploy deamon
            key: options.key,
            token: options.token,
            repo: options.repo,
            server: options.server,
            enviroment: options.env, // DONT NAME THIS PROPERTY ENV, IT PASSES WEIRD STUFF [obj obj]
            SERVICE: service,
            DAEMON: DAEMON_MODE
        }, function onStart(error){              // call thy self as a pm2 deamon
            if(error){
                console.log(error);
                process.exit(1);                 // ungraceful exit
            } else {
                console.log('aye aye, captain'); // Probably should log out pm2 status when this is done
                process.exit(0);
            }
        });
    }
};

if(process.env.DAEMON === DAEMON_MODE){  // given program is being called as a pm2 deamon
    run.servicePath = path.resolve(path.dirname(process.env.SERVICE)); // path of file that is passed TODO create method push to array of services
    run.deploy(process.env.SERVICE, process.env.key, process.env.enviroment, function startJitploy(){
        jitploy.init(process.env.repo, process.env.server, process.env.token, run.servicePath);       // start up socket client when service is deployed
    });                                  // run.deploy called in this manner initiates deployment steps
} else {
    cli.setup();                         // Assume process is being called from commandline when without DAEMON_MODE ENV
}
