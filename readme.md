### Jitploy Client

The purpose of this package is to provide a continuous deployment client

It connects to a server (Jitploy on github) that listens to a github webhook.
When that server gets a post from github about a pull request or push it signals this client to restart the services that uses that code

This client takes the following steps
 * pull from github
 * optionally decrypt version controlled configuration
 * npm install potential new packages
 * manage or pm2 restart process


### Status

Currently this packages serves the author's own purposes, it still needs a bit of work to be more generally useful

Though with heroku it would probably be easy to set up the server and client in a similar way to solve the same problem 
