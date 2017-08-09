// deploy.js  services that imediately deploys this service when it need to be updated
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
    env: process.env.ENVIRONMENT,
    key: process.env.CONFIG_KEY,
    crypto: require('crypto'),
    fs: require('fs'),
    options: {}, // ultimately config vars are stored here and past to program being tracked
    run: function(onFinsh){
        var readFile = config.fs.createReadStream(__dirname + '/encrypted_' + config.env);
        var decrypt = config.crypto.createDecipher('aes-256-ctr', config.key);
        var writeFile = config.fs.createWriteStream(__dirname + '/decrypted_' + config.env + '.js');
        readFile.pipe(decrypt).pipe(writeFile);
        writeFile.on('finish', function(){
            config.options = {env: require(__dirname + '/decrypted_' + config.env + '.js')};
            onFinsh(); // call next thing to do, prabably npm install
        });

    }
};

var run = {
    child: require('child_process'),
    deploy: function(){ // or at least start to
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

jitploy.init(process.env.JITPLOY_SERVER, process.env.CONNECT_TOKEN, process.env.REPO_NAME);
run.deploy();
