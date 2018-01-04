#!/usr/bin/env node
// jitploy.js ~ CLIENT ~ Copyright 2017 ~ Paul Beaudet MIT License
var path = require('path');
var fs = require('fs');
var CD_HOURS_START = 16;    // 5  pm UTC / 12 EST  // Defines hours when deployments can happen
var CD_HOURS_END   = 21;    // 10 pm UTC /  5 EST  // TODO Create an option to change default

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
    DEFAULT_SERVER: 'https://jitploy.herokuapp.com/',          // Defaults to sass server, you can run your own if you like
    io: require('socket.io-client'),                           // to connect to our jitploy intergration server
    client: null,
    init: function(token, repoName, server){
        if(!server){server = jitploy.DEFAULT_SERVER;}
        jitploy.client = jitploy.io(server);                   // jitploy socket server connection initiation
        jitploy.client.on('connect', function authenticate(){  // connect with orcastrator
            jitploy.client.emit('authenticate', {              // NOTE assumes TLS is in place otherwise this is useless
                token: token,
                name: repoName,
            });                                                // its important lisner know that we are for real
            jitploy.client.on('deploy', run.deploy);           // respond to deploy events
        });
        var timeToSleep = getMillis.toOffHours(CD_HOURS_START, CD_HOURS_END);
        setTimeout(function(){
            jitploy.takeABreak(token, repoName, server);
        }, timeToSleep);
    },
    takeABreak: function(token, repoName, server){
        jitploy.client.close();                               // stop bothering the server you'll keep it awake
        setTimeout(function startAgain(){                     // initialize the connection to deployment again tomorrow
            jitploy.init(token, repoName, server);
        }, getMillis.toTimeTomorrow(CD_HOURS_START));         // get millis to desired time tomorrow
    }
};

var config = {
    env: 'local', // process.env.ENVIRONMENT, // hard coding to local for now TODO make this configurable
    crypto: require('crypto'),
    options: {
        env: {}
    }, // ultimately config vars are stored here and past to program being tracked
    run: function(configKey, onFinsh){
        var readFile = fs.createReadStream(cmd.path + '/config/encrypted_' + config.env);
        var decrypt = config.crypto.createDecipher('aes-256-ctr',  configKey);
        var writeFile = fs.createWriteStream(cmd.path + '/config/decrypted_' + config.env + '.js');
        readFile.pipe(decrypt).pipe(writeFile);
        writeFile.on('finish', function(){
            config.options.env = require(cmd.path + '/config/decrypted_' + config.env + '.js');
            onFinsh(); // call next thing to do, prabably npm install // TODO probably should be passing environment vars
        });
    },
    check: function(servicePath, hasConfig){ // checks if config exist
        fs.stat(servicePath + '/config', function checkConfig(error, stats){
            if(error)                            {console.log('on checking config folder: ' + error);}
            else if(stats && stats.isDirectory()){hasConfig(true);}
            else                                 {hasConfig(false);}
        });
    }
};

var run = {
    child: require('child_process'),
    config: false,                   // default to false in case no can has config deploys assuming static config
    pm2: false,                      // not whether service process is being managed my pm2 or this service
    servicePath: false,
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
    deploy: function(servicePath, configKey, pm2){ // runs either on start up or every time jitploy server pings
        if(servicePath){run.servicePath = servicePath;}
        if(pm2){run.pm2 = true;}
        run.cmd('git pull', 'gitPull', function pullSuccess(){ // pull new code
            if(run.config){                                    // has config already been stored: deploy cases
                config.run(run.config.key, run.install);       // decrypt configuration then install
            } else if (configKey){                             // we need a key if we ever want to decrypt a config
                config.check(servicePath, function(hasConfig){ // first check if we have a config folder with things to decrypt at all
                    if(hasConfig){                             // only try to do any of this with a config folder
                        run.config = configKey;                // want to remember key so it can be passed each deploy
                        config.run(run.config.key, run.install); // decrypt configuration then install
                    }
                });
            } else {                                           // otherwise assume config is static on server
                run.install();                                 // npm install step, reflect package.json changes
            }
        }, function pullFail(code){console.log('no pull? ' + code);});
    },
    install: function(){ // and probably restart when done
        run.cmd('npm install', 'npmInstall', function installSuccess(){
            if(run.pm2){                         // in case pm2 is managing service let it do restart. Make sure watch flag is set
            } else {                             // otherwise this process is managing service
                if(run.service){
                    run.service.kill('SIGINT');  // send kill signal to current process then start it again
                } else {
                    run.start('starting up');    // given first start get recursive restart ball rolling
                }
            }
        }, function installFail(code){
            console.log('bad install? ' + code);
        });
    },
    start: function(code){
        console.log('restart event ' + code); // process automatically restarts in any case it stops
        run.cmd('npm run start', 'service', run.start, run.start);
    }
};

var cli = {
    program: require('commander'),
    setup: function(){
        cli.program
            .version(require('./package.json').version) // grabs currently published version
            .usage('[options] <file ...>')              // as far as I understand this is just for the help dialog
            .option('-k, --key <key>', 'key to unlock service config')
            .option('-t, --token <token>', 'config token to use service')
            .option('-r, --repo <repo>', 'repo name')
            .option('-s, --server <server>', 'jitploy server to connect to')
            .option('-p, --pm2 <pm2>', 'manage service with pm2')
            .action(cli.run);

        cli.program.parse(process.argv);
        if(cli.program.args.length === 0){cli.program.help();}
    },
    run: function(service, options){
        if(!options.token && !options.repo){                        // given required options are missing
            console.log('missing required config vars');
            return;
        }
        var servicePath = path.resolve(path.dirname(service));      // path of file that is passed
        jitploy.init(options.token, options.repo, options.server);  // start up socket client
        run.deploy(servicePath, options.key, options.pm2);          // runs deployment steps
    }
};

cli.setup();
