#!/usr/bin/env node
// jitploy.js ~ CLIENT ~ Copyright 2017 ~ Paul Beaudet MIT License
"use strict";
var path = require('path');
var fs = require('fs');
var CD_HOURS_START = 12;// 16;    // 5  pm UTC / 12 EST  // Defines hours when deployments can happen
var CD_HOURS_END   = 18;// 21;    // 10 pm UTC /  5 EST  // TODO Create an option to change default
var DAEMON_MODE = 'deamon_mode';
var SERVICE = 2; // Order arguments are taken in deamon mode
var OPTIONS = 3;
var DAEMON  = 4;
var CONFIG_FOLDER = '/jitploy';
var ALGORITHM = 'aes-128-cbc';

var getMillis = {
    toTimeTomorrow: function(hour){                     // millitary hour minus one
        var currentTime = new Date().getTime();         // current millis from epoch
        var tomorrowAtX = new Date();                   // create date object for tomorrow
        tomorrowAtX.setDate(tomorrowAtX.getDate() + 1); // point date to tomorrow
        tomorrowAtX.setHours(hour, 0, 0, 0);            // set hour to send tomorrow
        return tomorrowAtX.getTime() - currentTime;     // subtract tomo millis from epoch from current millis from epoch
    },
    toOffHours: function(hourStart, hourEnd){
        var currentDate = new Date();
        var currentHour = currentDate.getHours();
        if(currentHour < hourStart || currentHour > hourEnd){
            return 0;
        } // it is an off hour there is no millis till off
        var currentMillis = currentDate.getTime();
        var offTime = currentDate.setHours(hourEnd, 0, 0, 0);
        return offTime - currentMillis; // return millis before on time is up
    }
};

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
            });
            setTimeout(function(){
                jitploy.takeABreak(options.token, options.repo);
            }, getMillis.toOffHours(CD_HOURS_START, CD_HOURS_END));
        } else {console.log('Configuration issues');}              // maybe process should end itself if this is true
    },
    takeABreak: function(token, repo){
        console.log('Taking a break from continueous deployment');
        jitploy.client.close();                               // stop bothering the server you'll keep it awake
        setTimeout(function startAgain(){                     // initialize the connection to deployment again tomorrow
            console.log('Starting continueous deployment connection back up');
            jitploy.init({token:token, repo:repo});
        }, getMillis.toTimeTomorrow(CD_HOURS_START));         // get millis to desired time tomorrow
    }
};

var config = {
    env: 'local', // process.env.ENVIRONMENT, // hard coding to local for now TODO make this configurable
    crypto: require('crypto'),
    options: {
        env: {}
    }, // ultimately config vars are stored here and past to program being tracked
    run: function(configKey, iv, cwd, onFinsh){ // TODO add IV to everything else
        var readFile = fs.createReadStream(cwd + CONFIG_FOLDER + '/encrypted_' + config.env);
        var decrypt = config.crypto.createDecipheriv(ALGORITHM,  new Buffer(configKey, 'base64'), new Buffer(iv, 'base64'));
        var writeFile = fs.createWriteStream(cwd + CONFIG_FOLDER + '/decrypted_' + config.env + '.js');
        readFile.pipe(decrypt).pipe(writeFile);
        writeFile.on('finish', function(){
            config.options.env = require(cwd + CONFIG_FOLDER + '/decrypted_' + config.env + '.js');
            onFinsh(); // call next thing to do, prabably npm install // TODO probably should be passing environment vars
        });
    },
    check: function(servicePath, hasConfig){ // checks if config exist
        fs.stat(servicePath + CONFIG_FOLDER, function checkConfig(error, stats){
            if(error)                            {console.log('on checking config folder: ' + error);}
            else if(stats && stats.isDirectory()){hasConfig(true);}
            else                                 {hasConfig(false);}
        });
    },
    lock: function(dir, options){   // Polymorphic, creates template or encrypts potential changes and additions
        var env = 'local'; // default value for evinviornment
        if(options && options.env){env = options.env;}
        var servicePath = path.resolve(path.dirname(dir));
        fs.mkdir(servicePath + CONFIG_FOLDER, function(error){
            if(error){
                if(error.code === 'EEXIST'){config.template(servicePath, env);} // Internet said this was a bad idea
                else {console.log('Error on making directory: ' + error);}
            } else {config.template(servicePath);}
        });
    },
    template: function(servicePath, env){
        var configFile = servicePath + CONFIG_FOLDER + '/decrypted_' + env + '.js';
        fs.open(configFile, 'wx', function template(error, fileData){
            if(error){
                if(error.code === 'EEXIST'){                             // In case where decrypted file exist
                    var existing = require(configFile);                  // read shared secret and initialization vector
                    if(existing.JITPLOY_SHARED_KEY && existing.JITPLOY_IV){
                        config.encrypt(servicePath, env, existing.JITPLOY_SHARED_KEY, existing.JITPLOY_IV);
                    } else {console.log('shared key is missing, not sure what to do');}
                } else { console.log('on checking for config file: ' + error);}
            } else {
                var sharedSecret = config.crypto.randomBytes(16).toString('base64');
                var initializationVector = config.crypto.randomBytes(16).toString('base64');
                fs.writeFile(fileData,
                    'module.exports = {\n' +
                    '    JITPLOY_SHARED_KEY: \'' + sharedSecret + '\',\n' +
                    '    JITPLOY_IV: \'' + initializationVector + '\'\n' +
                    '};\n',
                    function onWrite(writeErr){ // TODO create key and iv write them to file
                        if(writeErr){console.log('shite');}
                        else{
                            console.log('No config exist for this environment. Made template one with shared key');
                            console.log('Configuration can be found at ' + configFile);
                            console.log('Please add configuration to this file');
                        }
                    }
                );
            }
        });
    },
    encrypt: function(servicePath, env, sharedSecret, iv){
        fs.stat(servicePath + CONFIG_FOLDER + '/encrypted_' + env, function template(error, stats){ // test if we have env file we are looking for
            var readFile = fs.createReadStream(servicePath + CONFIG_FOLDER + '/decrypted_' + env + '.js');
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
    deploy: function(service){                        // what to do on deploy step
        for(var proc = 0; proc < pm2.daemons.length; proc++){
            if(pm2.daemons[proc] === service){
                pm2.pkg.restart(service, pm2.onTurnOver);
                return true;                         // exit function when we have found what we are looking for
            }
        }
        pm2.startup(service, pm2.onTurnOver);  // given function has yet to exit
    },
    startup: function(service, onStart, args){             // deamonizes pm2 which will run app non interactively
        pm2.pkg.connect(function onPM2connect(error){        // This would also connect to an already running deamon if it exist
            if(error){onStart(error);}                       // abstract error handling
            else {
                if(!args){args = [];}                        // given no arguments pass no arguments
                pm2.pkg.start({script: service, args: args, logDateFormat:"YYYY-MM-DD HH:mm Z"}, function initStart(err, proc){
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
    pm2: false,                      // not whether service process is being managed my pm2 or this service
    servicePath: false,
    startCMD: 'npm run start',       // default command for starting an application
    PATH: process.env.PATH,
    cmd: function(command, cmdName, onSuccess, onFail){
        command = 'cd ' + run.servicePath + ' && PATH=' + run.PATH + ' ' + command; // cwd makes sure we are in working directory that we originated from
        console.log('running command:' + command);
        run[cmdName] = run.child.exec(command, config.options);
        run[cmdName].stdout.on('data', function(data){console.log("" + data);});
        run[cmdName].stderr.on('data', function(data){console.log("" + data);});
        run[cmdName].on('close', function doneCommand(code){
            if(code){onFail(code);}
            else {onSuccess();}
        });
        run[cmdName].on('error', function(error){console.log('child exec error: ' + error);});
    },
    deploy: function(service, options){                                      // runs either on start up or every time jitploy server pings
        if(service){
            run.service = service;
            run.servicePath = path.resolve(path.dirname(service));
        }  // path of file that is passed
        if(options){ // remember we get non-when server triggers deploy
            if(options.eco){                                         // can only use ether ecosystem or pm2 not both, only need to set on startup
                var ecoConfig = require(run.servicePath + '/ecosystem.config.js'); // import config module, that one would otherwise use for pm2
                run.startCMD = 'node ' + ecoConfig.apps[0].script;   // config should have absolute path to service
                config.options.env = ecoConfig.apps[0].env;          // In this config is loaded from this ecosystem file and can only change on restart
            }
            run.pull(options.configKey);
        } else {run.pull();}                                     // we are just concerned with pulling when server ask for a deploy
    },
    pull: function(configKey){
        run.cmd('git pull', 'gitPull', function pullSuccess(){   // pull new code
            if(run.config){                                      // has config already been stored: deploy cases
                config.run(run.config.key, run.install);         // decrypt configuration then install
            } else if (configKey){                               // we need a key if we ever want to decrypt a config
                config.check(run.servicePath, function(hasConfig){ // first check if we have a config folder with things to decrypt at all
                    if(hasConfig){                               // only try to do any of this with a config folder
                        run.config = configKey;                  // want to remember key so it can be passed each deploy
                        config.run(run.config.key, run.servicePath, run.install); // decrypt configuration then install
                    }
                });
            } else {                                           // otherwise assume config is static on server
                run.install();                                 // npm install step, reflect package.json changes
            }
        }, function pullFail(code){console.log('no pull? ' + code);});
    },
    install: function(){ // and probably restart when done
        run.cmd('npm install', 'npmInstall', function installSuccess(){
            pm2.deploy(run.service); // once npm install is complete restart service
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
            .usage('[options] <file ...>')               // as far as I understand this is just for the help dialog
            .option('-k, --key <key>', 'key to unlock service config')
            .option('-t, --token <token>', 'config token to use service')
            .option('-r, --repo <repo>', 'repo name')
            .option('-s, --server <server>', 'jitploy server to connect to')
            .option('-e, --eco <eco>', 'manage service directly with ecosystem file')
            .action(cli.run);
        cli.program
            .command('configlock')
            .usage('[options] <directory ...>')
            .option('-e, --env <env>', 'environment being encrypted')
            .description('encrypts configuration')
            .alias('lock')
            .action(config.lock);
        cli.program
            .command('decrypt')
            .usage('[options] <directory ...>')
            .option('-g, --secret <secret>', 'key to unlock service config')
            .option('-i, --iv <iv>', 'initialization Vector, my pokemons will be amazing')
            .alias('unlock')
            .action(function(dir, options){
                config.run(options.secret, options.iv, path.resolve(path.dirname(dir)), function onFinish(){
                    console.log('Decrypted config');
                });
            });
        cli.program.parse(process.argv);
        if(cli.program.args.length === 0){cli.program.help();}
    },
    run: function(service, options){
        if(!options.token && !options.repo){                        // given required options are missing
            console.log('missing required config vars');
            process.exit(1);
        }
        var optionsToStringify = {
            key: options.key,
            token: options.token,
            repo: options.repo,
            server: options.server,
            eco: options.eco
        };
        pm2.startup('jitploy', function onStart(error){               // call thy self as a pm2 deamon
            if(error){
                console.log(error);
                process.exit(1);    // ungraceful exit
            } else {process.exit(0);}
        }, [service, JSON.stringify(optionsToStringify), DAEMON_MODE]);  // args to pass jitploy deamon
    }
};

if(process.argv[DAEMON] === DAEMON_MODE){            // given program is being called as a pm2 deamon
    var options = JSON.parse(process.argv[OPTIONS]); // turn string back into an object
    jitploy.init(options);                           // start up socket client
    run.deploy(process.argv[SERVICE], options);      // runs deployment steps
} else {
    cli.setup();
}
