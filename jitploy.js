#!/usr/bin/env node
// jitploy.js ~ CLIENT ~ Copyright 2017 ~ Paul Beaudet MIT License

var path = require('path');
var fs = require('fs');
// var PATH = ' PATH=' + process.env.PATH + ' ';// assuming this is started manually, will help find node/npm, otherwise exact paths are needed

var CD_HOURS_START = 11;                     // 12 pm Defines hours when deployments can happen
var CD_HOURS_END   = 16;                     // 5 pm

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
    io: require('socket.io-client'),                           // to connect to our jitploy intergration server
    client: null,
    init: function(server, token, repoName){
        jitploy.client = jitploy.io(server);                   // jitploy socket server connection initiation
        jitploy.client.on('connect', function authenticate(){  // connect with orcastrator
            jitploy.client.emit('authenticate', {              // NOTE assumes TLS is in place otherwise this is useless
                token: token,
                name: repoName,
            });                                                // its important lisner know that we are for real
            jitploy.client.on('deploy', run.initCD);           // respond to deploy events
        });
        var timeToSleep = getMillis.toOffHours(CD_HOURS_START, CD_HOURS_END);
        setTimeout(function(){
            jitploy.takeABreak(server, token, repoName);
        }, timeToSleep);
    },
    takeABreak: function(server, token, repoName){
        jitploy.client.close();                               // stop bothering the server you'll keep it awake
        setTimeout(function startAgain(){                     // initialize the connection to deployment again tomorrow
            jitploy.init(server, token, repoName);
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
    }
};

var run = {
    child: require('child_process'),
    config: { has: false },          // default to false in case no can has config deploys assuming static config
    pm2service: false,
    cmd: function(command, cmdName, onSuccess, onFail){
        command = run.cwd + command; // cwd makes sure we are in working directory that we originated from
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
    initCD: function(hasConfig, configKey, pm2service){        // runs either on start up or every time jitploy server pings
        if(pm2service){run.pm2service = pm2service;}
        run.cmd('git pull', 'gitPull', function pullSuccess(){ // pull new code
            if(run.config.has){                                // has config already been stored: deploy cases
                config.run(run.config.key, run.install);       // decrypt configuration then install
            } else if (hasConfig){
                if(hasConfig && configKey){                    // on the first run if we have a config, in this way populating config means its possible
                    run.config.has = hasConfig;                // only try to do any of this with a config folder
                    run.config.key = configKey;                // want to remember key so it can be passed each deploy
                    config.run(run.config.key, run.install);   // decrypt configuration then install
                } else {
                    console('no can has config ');             // probably forgot to pass config key
                }
            } else {                                           // otherwise assume config is static on server
                run.install();                                 // npm install step, reflect package.json changes
            }
        }, function pullFail(code){
            console.log('no pull? ' + code);
        });
    },
    install: function(usePm2){ // and probably restart when done
        run.cmd('npm install', 'npmInstall', function installSuccess(){
            if(run.pm2.service){  // in case pm2 is managing service
                run.pm2Restart(run.pm2.service);
            } else {         // otherwise this process is managing service
                if(run.service){
                    run.service.kill('SIGINT'); // send kill signal to current process then start it again
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
    },
    pm2Restart: function(nameOfService){
        run.cmd('pm2 restart ' + nameOfService, 'service', function restartSuccess(){
            console.log('restart success?');
        }, function restartFail(code){
            console.log('pm2 restart fail ' + code);
        });
    }
};


var cmd = {
    run: function(service){
        if(cli.program.server && cli.program.token && cli.program.repo){
        } else {
            console.log('sorry youll need to put in flags as if they were required config vars');
            return;
        }
        if(service){
            cmd.path = path.resolve(path.dirname(service)); // path of file that is passed
        } else {
            console.log('path of directory' + __dirname);   // TODO test if this works, probably not
            cmd.path = path.resolve(__dirname);
        }
        run.cwd = 'cd ' + cmd.path + ' && '; // prepended to every command to be sure we are in correct directory
        jitploy.init(cli.program.server, cli.program.token, cli.program.repo);
        cmd.checkConfig(function hasConfig(configOrNoConfig){
            if(service){
                run.initCD(configOrNoConfig, cli.program.key);                   // given a file was passed assume this client is managing executible
            } else {                                                             // assume service is being managed by pm2 if nothing is passed
                run.initCD(configOrNoConfig, cli.program.key, cli.program.repo); // repo name should equate what service is named in pm2
            }
        });
    },
    checkConfig: function(hasConfig){
        fs.stat(cmd.path + '/config', function checkConfig(error, stats){
            if(error){
                console.log('on checking config folder: ' + error);
            } else if (stats && stats.isDirectory()){
                hasConfig(true);
            } else {
                hasConfig(false);
            }
        });
    }
};

var cli = {
    program: require('commander'),
    setup: function(){
        cli.program
            .version(require('./package.json').version) // this might work? seems questionable
            .usage('[options] <file ...>')
            .option('-k, --key <key>', 'key to unlock service config')
            .option('-t, --token <token>', 'config token to use service')
            .option('-r, --repo <repo>', 'repo name')
            .option('-s, --server <server>', 'jitploy server to connect to')
            .arguments('<service>')
            .action(cmd.run);

        cli.program.parse(process.argv);
        if(cli.program.args.length > 1){cli.program.help();} // given more than one thing is pass show help
    }
};

cli.setup();
