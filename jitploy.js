#!/usr/bin/env node
// jitploy.js ~ CLIENT ~ Copyright 2017 ~ Paul Beaudet MIT License

var path = require('path');
var fs = require('fs');
var PATH = ' PATH=' + process.env.PATH + ' ';// assuming this is started manually, will help find node/npm, otherwise exact paths are needed

var CD_HOURS_START = 11;                     // 12 pm Defines hours when deployments can happen
var CD_HOURS_END   = 22;                     // 11 pm

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
            jitploy.client.emit('authenticate', {
                token: token,
                name: repoName,
            });                                                // its important lisner know that we are for real
            jitploy.client.on('deploy', run.deploy);           // respond to deploy events
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
    env: 'local', // process.env.ENVIRONMENT, // hard coding to local for now
    crypto: require('crypto'),
    options: {
        env: {}
    }, // ultimately config vars are stored here and past to program being tracked
    run: function(onFinsh){
        var readFile = fs.createReadStream(cmd.path + '/config/encrypted_' + config.env);
        var decrypt = config.crypto.createDecipher('aes-256-ctr',  cli.program.key); // TODO probably should be passed in instead
        var writeFile = fs.createWriteStream(cmd.path + '/config/decrypted_' + config.env + '.js');
        readFile.pipe(decrypt).pipe(writeFile);
        writeFile.on('finish', function(){
            config.options.env = require(cmd.path + '/config/decrypted_' + config.env + '.js');
            onFinsh(); // call next thing to do, prabably npm install
        });

    }
};

var run = {
    child: require('child_process'),
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
    deploy: function(){ // or at least start to
        run.cmd('git pull', 'gitPull', function pullSuccess(){
            config.run(run.install); // decrypt configuration then install
        }, function pullFail(code){
            console.log('no pull? ' + code);
        });
    },
    install: function(){ // and probably restart when done
        run.cmd(PATH + 'npm install', 'npmInstall', function installSuccess(){
            if(run.service){
                run.service.kill();       // send kill signal to current process then start it again
            } else {
                run.start('starting up'); // given first start get recursive restart ball rolling
            }
        }, function installFail(code){
            console.log('bad install? ' + code);
        });
    },
    start: function(code){
        console.log('restart event ' + code); // process automatically restarts in any case it stops
        run.cmd(PATH + 'npm run start', 'service', run.start, run.start);
    }
};


var cmd = {
    run: function(service){
        if(cmd.insuficientFlags()){
            console.log('sorry youll need to put in flags as if they were required config vars');
            return;
        }
        cmd.path = path.resolve(path.dirname(service));
        run.cwd = 'cd ' + cmd.path + ' && '; // prepended to every command to be sure we are in correct directory
        cmd.checkConfig(function ifConfigFolder(){
            jitploy.init(cli.program.server, cli.program.token, cli.program.repo);
            run.deploy();
        });
    },
    insuficientFlags: function(){
        if(cli.program.server && cli.program.token && cli.program.repo && cli.program.key){
            return false;
        } else {
            return true;
        }
    },
    checkConfig: function(successCallback){
        fs.stat(cmd.path + '/config', function checkConfig(error, stats){
            if(error){
                console.log('no config folder: ' + error);
            } else if (stats && stats.isDirectory()){
                successCallback();
            } else {
                console.log('no config folder');
            }
        });
    }
}

var cli = {
    program: require('commander'),
    setup: function(){
        cli.program
            .version('0.0.1')
            .usage('[options] <file ...>')
            .option('-k, --key <key>', 'key to unlock service config')
            .option('-t, --token <token>', 'config token to use service')
            .option('-r, --repo <repo>', 'repo name')
            .option('-s, --server <server>', 'jitploy server to connect to')
            .arguments('<service>')
            .action(cmd.run);
            
        cli.program.parse(process.argv);
        if(cli.program.args.length === 0){cli.program.help();}
    }
}

cli.setup();
