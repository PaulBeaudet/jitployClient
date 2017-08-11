#!/usr/bin/env node
// jitploy.js ~ Copyright 2017 ~ Paul Beaudet MIT License

var path = require('path');

var PATH = ' PATH=' + process.env.PATH + ' ';// assuming this is started manually, will help find node/npm, otherwise exact paths are needed

var jitploy = {
    io: require('socket.io-client'),                       // to connect to our jitploy intergration server
    init: function(server, token, repoName){
        jitploy.io = jitploy.io(server);                   // jitploy socket server connection initiation
        jitploy.io.on('connect', function authenticate(){  // connect with orcastrator
            jitploy.io.emit('authenticate', {
                token: token,
                name: repoName,
            });                                            // its important lisner know that we are for real
            jitploy.io.on('deploy', run.deploy);           // respond to deploy events
        });
    }
};

var config = {
    env: 'local', // process.env.ENVIRONMENT, // hard coding to local for now
    crypto: require('crypto'),
    fs: require('fs'),
    options: {}, // ultimately config vars are stored here and past to program being tracked
    run: function(serviceDir, onFinsh){
        var readFile = config.fs.createReadStream(serviceDir + '/config/encrypted_' + config.env);
        var decrypt = config.crypto.createDecipher('aes-256-ctr', cli.program.key); // TODO probably should be passed in instead
        var writeFile = config.fs.createWriteStream(serviceDir + '/config/decrypted_' + config.env + '.js');
        readFile.pipe(decrypt).pipe(writeFile);
        writeFile.on('finish', function(){
            config.options = {env: require(serviceDir + '/config/decrypted_' + config.env + '.js')};
            onFinsh(); // call next thing to do, prabably npm install
        });

    }
};

var run = {
    child: require('child_process'),
    deploy: function(service){ // or at least start to
        var gitPull = run.child.exec('git pull');
        gitPull.stdout.on('data', function(data){console.log("" + data);});
        gitPull.stderr.on('data', function(data){console.log("" + data);});
        gitPull.on('close', function donePull(code){
            if(code){console.log('no pull? ' + code);}
            else {config.run(run.install);} // decrypt configuration then install
        });
    },
    install: function(){ // and probably restart when done
        var npmInstall = run.child.exec(PATH+'npm install');
        npmInstall.stdout.on('data', function(data){console.log("" + data);});
        npmInstall.stderr.on('data', function(data){console.log("" + data);});
        npmInstall.on('close', function doneInstall(code){
            if(code){console.log('bad install? ' + code);}
            else {
                if(run.service){run.service.kill();} // send kill signal to current process then start it again
                else           {run.start();}        // if its not already start service up
            }
        });
    },
    start: function(code){
        if(code){console.log('restart with code: ' + code);}
        run.service = run.child.exec(PATH+'npm run start', config.options); // make sure service will run on npm run start
        run.service.stdout.on('data', function(data){console.log("" + data);});
        run.service.stderr.on('data', function(data){console.log("" + data);});
        run.service.on('close', run.start); // habituly try to restart process
        run.service.on('error', function(error){console.log('child exec error: ' + error);});
    }
};

var cmd = {
    run: function(service){
        if(cli.program.server && cli.program.token && cli.program.repo && cli.program.key){
            jitploy.init(cli.program.server, cli.program.token, cli.program.repo);
            // run.deploy(service);
        } else {
            console.log('sorry youll need to put in flags as if they were required config vars');
        }
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
