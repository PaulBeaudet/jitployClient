#!/usr/bin/env node
// jitploy.js ~ CLIENT ~ Copyright 2017 ~ Paul Beaudet MIT License
"use strict";
var path = require('path');
var fs = require('fs');
var DAEMON_MODE = 'deamon_mode';
var CONFIG_FOLDER = '/jitploy';
var ALGORITHM = 'aes-128-cbc';

var jitploy = {
    SERVER: 'https://jitploy.herokuapp.com/',                  // Defaults to sass server, you can run your own if you like
    io: require('socket.io-client'),                           // to connect to our jitploy intergration server
    client: null,
    init: function(options){
        if(options && options.token && options.repo){
            if(options.server){jitploy.SERVER = options.server;}
            jitploy.client = jitploy.io(jitploy.SERVER);           // jitploy socket server connection initiation
            jitploy.client.on('connect', function authenticate(){  // connect with orcastrator
                jitploy.client.emit('authenticate', {              // NOTE assumes TLS is in place otherwise this is useless
                    token: options.token,
                    name: options.repo
                });                                                // its important lisner know that we are for real
                jitploy.client.on('deploy', run.deploy);           // respond to deploy events
                jitploy.client.on('break', function breakTime(data){
                    if(data.time){jitploy.takeABreak(options.token, options.repo, data.time);}
                });
            });
        } else {console.log('Configuration issues');}              // maybe process should end itself if this is true
    },
    takeABreak: function(token, repo, durration){
        console.log('Taking a break from continueous deployment');
        jitploy.client.close();                               // stop bothering the server you'll keep it awake
        setTimeout(function startAgain(){                     // initialize the connection to deployment again tomorrow
            console.log('Starting continueous deployment connection back up');
            jitploy.init({token:token, repo:repo});
        }, durration);         // get millis to desired time tomorrow
    }
};

var config = {
    env: 'local', // hard coding to local for now TODO make this configurable
    crypto: require('crypto'),
    yaml: require('js-yaml'),
    decrypt: function(configKey, cwd, onFinish, env){
        if(env){config.env = env;} // If specified change default env to specified one so that it is called on subsequent deploys
        else{env = config.env;}    // Given no specification use default env
        if(configKey){             // shared secret aka important part of decrypting something
            fs.stat(cwd + CONFIG_FOLDER + '/encrypted_' + env, function onFileCheck(error, stats){
                if(error){
                    console.log(error);
                    onFinish();
                } else if(stats.isFile()){ // if this file exist we have something to read from and a folder to write into
                    var readFile = fs.createReadStream(cwd + CONFIG_FOLDER + '/encrypted_' + env);
                    var sharedKey = configKey.substr(0, configKey.length/2);
                    var iv = configKey.substr(configKey.length/2, configKey.length);
                    var decrypt = config.crypto.createDecipheriv(ALGORITHM,  new Buffer(sharedKey, 'base64'), new Buffer(iv, 'base64'));
                    var writeFile = fs.createWriteStream(cwd + CONFIG_FOLDER + '/decrypted_' + env + '.yml');
                    readFile.pipe(decrypt).pipe(writeFile);
                    writeFile.on('finish', function(){
                        fs.readFile(cwd + CONFIG_FOLDER + '/decrypted_' + env + '.yml', 'utf8', function(err, data){
                            onFinish(config.yaml.safeLoad(data));   // pass env vars and call next thing to do
                        });
                    });
                } else {console.log('config: no file or error'); onFinish();}
            });
        } else {onFinish();} // No encrypted config is an option, in this case just pass through
    },
    lock: function(dir, env, tempOnly){   // Polymorphic, creates template or encrypts potential changes and additions
        if(!env){env = config.env;}
        var servicePath = path.resolve(path.dirname(dir));
        fs.mkdir(servicePath + CONFIG_FOLDER, function(mkdirError){
            if(mkdirError){
                if(mkdirError.code === 'EEXIST'){config.template(servicePath, env, tempOnly);} // Internet said this was a bad idea
                else {console.log('Error on making directory: ' + mkdirError);}
            } else { // given this is first time configuring, want to exclude decrypted file patterns from version control
                fs.appendFile(servicePath + '/.gitignore', CONFIG_FOLDER.substr(1, CONFIG_FOLDER.length) + '/decrypted_*', function addedToGitignore(appendError){
                    if(appendError){console.log('Failed to exclude decrypted file from git, you might want to manually do that: ' + appendError);}
                    config.template(servicePath, env, tempOnly); // Create decrypted file template regardless
                });
            }
        });
    },
    template: function(servicePath, env, tempOnly){
        var configFile = servicePath + CONFIG_FOLDER + '/decrypted_' + env + '.yml';
        fs.open(configFile, 'wx', function template(error, fileData){
            if(error){
                if(error.code === 'EEXIST' && !tempOnly){                    // In case where decrypted file exist
                    fs.readFile(configFile, function readTheFile(readErr, data){
                        var existing = config.yaml.safeLoad(data);
                        if(existing.JITPLOY_SHARED_KEY){
                            var sharedKey = existing.JITPLOY_SHARED_KEY.substr(0, existing.JITPLOY_SHARED_KEY.length/2);
                            var iv = existing.JITPLOY_SHARED_KEY.substr(existing.JITPLOY_SHARED_KEY.length/2, existing.JITPLOY_SHARED_KEY.length);
                            config.encrypt(servicePath, env, sharedKey, iv);
                        } else {console.log('shared key is missing, not sure what to do');}
                    });
                } else { console.log('on attempting to work config file: ' + error);}
            } else {
                var sharedSecret = config.crypto.randomBytes(16).toString('base64');
                var initializationVector = config.crypto.randomBytes(16).toString('base64');
                fs.writeFile(fileData,
                    '# Add properties to this module in order set configuration for ' + env + ' environment\n' +
                    '{\n' +
                    '    JITPLOY_SHARED_KEY: \'' + sharedSecret + initializationVector + '\' # Shared key for remote target enviroment, encrypts this file\n' +
                    '}\n',
                    function onWrite(writeErr){ // TODO create key and iv write them to file
                        if(writeErr){console.log('template write error: ' + writeErr);}
                        else{
                            console.log('Configuration template made for ' + env + ' at ' + configFile);
                            console.log('Edit this file to add enviroment variables that will be decrypted by a shared key on deployment');
                        }
                    }
                );
            }
        });
    },
    encrypt: function(servicePath, env, sharedSecret, iv){
        fs.stat(servicePath + CONFIG_FOLDER + '/encrypted_' + env, function template(error, stats){ // test if we have env file we are looking for
            var readFile = fs.createReadStream(servicePath + CONFIG_FOLDER + '/decrypted_' + env + '.yml');
            var encrypt = config.crypto.createCipheriv(ALGORITHM, new Buffer(sharedSecret, 'base64'), new Buffer(iv, 'base64'));
            var writeFile = fs.createWriteStream(servicePath + CONFIG_FOLDER + '/encrypted_' + env);
            readFile.pipe(encrypt).pipe(writeFile);
        });
    }
};

var pm2 = {
    pkg: require('pm2'),                              // Process management 2 library
    daemons: [],                                      // Array of daemons being managed by this application (Jitploy itself, apps its listening for)
    onTurnOver: function(error, proccessInfo){        // generic handler for errCallback, see pm2 API
        if(error){console.log(error);}
    },
    deploy: function(service, env){                   // what to do on deploy step
        var existing = false;
        for(var proc = 0; proc < pm2.daemons.length; proc++){
            if(pm2.daemons[proc] === service){existing = true;}
        }
        if(existing){
            pm2.pkg.delete(service, function onStop(error){
                if(error){console.log(error);}
                pm2.startup(service, env, pm2.onTurnOver);
            });
        } else {
            pm2.startup(service, env, pm2.onTurnOver);       // given function has yet to exit
        }
    },
    startup: function(service, env, onStart){                // deamonizes pm2 which will run app non interactively
        pm2.pkg.connect(function onPM2connect(error){        // This would also connect to an already running deamon if it exist
            if(error){onStart(error);}                       // abstract error handling
            else {
                if(!env){env = {};}                          // given no arguments pass no arguments
                pm2.pkg.start({script: service, env: env, logDateFormat:"YYYY-MM-DD HH:mm Z"}, function initStart(err, proc){
                    pm2.daemons.push(service);               // add this name to our list of running daemons
                    onStart(err);
                });
            } // after connected with deamon start process in question
        });
    }
};

var run = {
    child: require('child_process'),
    config: false,                   // default to false in case no can has config deploys assuming static config
    servicePath: false,
    startCMD: 'npm run start',       // default command for starting an application
    PATH: process.env.PATH,
    cmd: function(command, cmdName, onSuccess, onFail){
        console.log('Jitploy running:' + command);
        command = 'cd ' + run.servicePath + ' && PATH=' + run.PATH + ' ' + command; // cwd makes sure we are in working directory that we originated from
        run[cmdName] = run.child.exec(command);
        run[cmdName].stdout.on('data', console.log);
        run[cmdName].stderr.on('data', console.log);
        run[cmdName].on('close', function doneCommand(code){
            if(code){onFail(code);}
            else {onSuccess();}
        });
        run[cmdName].on('error', function(error){console.log('child exec error: ' + error);});
    },
    deploy: function(service, configKey, env){                     // runs either on start up or every time jitploy server pings
        if(service){                                               // given this is being called from cli
            run.service = service;
            run.servicePath = path.resolve(path.dirname(service)); // path of file that is passed
            if(configKey){run.config = configKey;}                 // Set config key, if we have something to decrypt and something to do it with
        }
        run.pull(env);  // remember we get nothing when server triggers deploy
    },
    pull: function(env){
        run.cmd('git pull', 'gitPull', function pullSuccess(){             // pull new code
            config.decrypt(run.config, run.servicePath, run.install, env); // decrypt configuration if it exist then install
        }, function pullFail(code){console.log('no pull? ' + code);});
    },
    install: function(configVars){ //  npm install step, reflect package.json changes and probably restart when done
        run.cmd('npm install', 'npmInstall', function installSuccess(){
            pm2.deploy(run.service, configVars); // once npm install is complete restart service
        }, function installFail(code){
            console.log('bad install? ' + code);
        });
    }
};

var cli = {
    program: require('commander'),
    setup: function(){
        cli.program
            .version(require('./package.json').version); // grabs currently published version
        cli.program
            .usage('[options] <file ...>')
            .option('-k, --key <key>', 'key to unlock service config')
            .option('-t, --token <token>', 'config token to use service')
            .option('-r, --repo <repo>', 'repo name')
            .option('-s, --server <server>', 'jitploy server to connect to')
            .option('-e, --env <env>', 'unlocks for x enviroment')
            .action(cli.run);
        cli.program
            .command('lock')
            .usage('[options] <directory ...>')
            .description('encrypts configuration, on templates a decrypted file if its non existent')
            .action(function encryptIt(dir, options){config.lock(dir, options.parent.env);});
        cli.program
            .command('unlock')
            .usage('[options] <directory ...>')
            .action(function decryptIt(dir, options){config.decrypt(options.parent.key, path.resolve(path.dirname(dir)), console.log, options.parent.env);});
        cli.program
            .command('template')
            .usage('[options] <directory ...>')
            .action(function templateConfig(dir, options){config.lock(dir, options.parent.env, true);}); // Pass true for template only option
        cli.program.parse(process.argv);
        if(cli.program.args.length === 0){cli.program.help();}
    },
    run: function(service, options){
        if(!options.token && !options.repo){                        // given required options are missing
            console.log('missing required config vars');
            process.exit(1);
        }
        pm2.startup(process.argv[1], {  // Env vars to pass jitploy deamon
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

if(process.env.DAEMON === DAEMON_MODE){              // given program is being called as a pm2 deamon
    jitploy.init({
        token: process.env.token,
        repo: process.env.repo,
        server: process.env.server
    }); // start up socket client
    run.deploy(process.env.SERVICE, process.env.key, process.env.enviroment); // runs deployment steps
} else {
    cli.setup();
}
