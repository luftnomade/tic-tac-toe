const express = require("express");
const app = express();
const server = require("http").Server(app);
const path = require("path");
const io = require("socket.io")(server);
const port = process.env.PORT || 3000;
const pino = require("pino")();
const _ = require("lodash");

const players = {};
const waitingList = [];

app.use(express.static(path.join(__dirname, "public")));

const WON_FIELDS = [
  ["0", "1", "2"],
  ["3", "4", "5"],
  ["6", "7", "8"],
  ["0", "3", "6"],
  ["1", "4", "7"],
  ["2", "5", "8"],
  ["0", "4", "8"],
  ["2", "4", "6"]
];

const checkWon = id => {
  for (wonRow of WON_FIELDS) {
    if (
      players[id].fields.indexOf(wonRow[0]) !== -1 &&
      players[id].fields.indexOf(wonRow[1]) !== -1 &&
      players[id].fields.indexOf(wonRow[2]) !== -1
    ) {
      return true;
    }
  }
  return false;
};

const checkTie = socketId => {
  return (
    players[socketId].fields.length +
      players[players[socketId].teamPlayer].fields.length ===
    9
  );
};

const checkValidMove = (socketId, move) => {
  return (
    players[socketId].turn &&
    players[socketId].fields.indexOf(move) === -1 &&
    players[players[socketId].teamPlayer].fields.indexOf(move) === -1 &&
    ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].indexOf(move) !== -1
  );
};

const getRandomInt = (max, addOne) => {
  const add = addOne ? 1 : 0;
  return Math.round(Math.random() * max) + add;
};

const startGame = (player1, player2) => {
  pino.info(`starting game`);

  players[player1].id = getRandomInt(1, true);
  players[player1].turn = !!getRandomInt(1, false);
  players[player1].fields = [];
  players[player2].id = players[player1].id === 1 ? 2 : 1;
  players[player2].turn = !players[player1].turn;
  players[player2].fields = [];

  const variant = getRandomInt(3, true);

  io.sockets.in(player1).emit("startGame", {
    player: players[player1].id,
    variant,
    turn: players[player1].turn
  });
  io.sockets.in(player2).emit("startGame", {
    player: players[player2].id,
    variant,
    turn: players[player2].turn
  });
};

io.on("connection", function(socket) {
  pino.info(`socket ${socket.id} connected`);
  players[socket.id] = {
    state: "start"
  };
  socket.emit("changeState", "start");

  socket.on("disconnect", reason => {
    pino.info(`socket ${socket.id} disconnected`);
    if (players[socket.id].state === "waiting") {
      const position = waitingList.indexOf(socket.id);
      waitingList.splice(position, 1);
    } else if (players[socket.id].state === "playing") {
      const teamPlayer = players[socket.id].teamPlayer;
      io.sockets.in(teamPlayer).emit("teamPlayerLeft", {
        player: players[socket.id].id,
        variant: getRandomInt(3, true)
      });
      setTimeout(() => {
        if (players[teamPlayer]) {
          players[teamPlayer].state = "start";
          io.sockets.in(teamPlayer).emit("changeState", "start");
        }
      }, 4000);
    }

    delete players[socket.id];
  });

  socket.on("joinWaitingList", () => {
    players[socket.id].state = "waiting";
    socket.emit("changeState", "waiting");
    pino.info(`socket ${socket.id} joining waiting list`);
    waitingList.push(socket.id);
    if (waitingList.length > 1) {
      const player1 = waitingList.shift();
      const player2 = waitingList.shift();
      players[player1].state = "playing";
      players[player2].state = "playing";
      players[player1].teamPlayer = player2;
      players[player2].teamPlayer = player1;
      io.sockets.in(player1).emit("changeState", "playing");
      io.sockets.in(player2).emit("changeState", "playing");
      startGame(player1, player2);
      pino.info(`start game for players ${player1} and ${player2}`);
    }
  });

  socket.on("move", function(move) {
    if (!checkValidMove(socket.id, move)) {
      pino.info({ player: socket.id, move }, "invalid move");
      return;
    }
    pino.info(`player ${socket.id} made move ${move}`);
    players[socket.id].fields.push(move);
    players[socket.id].turn = false;
    players[players[socket.id].teamPlayer].turn = true;
    pino.info(players[socket.id].fields, `player ${socket.id} updated fields`);
    const variant = getRandomInt(3, true);
    socket.emit("move", {
      player: players[socket.id].id,
      variant,
      move: move,
      turn: players[socket.id].turn
    });
    io.sockets.in(players[socket.id].teamPlayer).emit("move", {
      player: players[socket.id].id,
      variant,
      move: move,
      turn: players[players[socket.id].teamPlayer].turn
    });
    if (checkWon(socket.id)) {
      socket.emit("wonGame", {
        player: players[socket.id].id,
        won: true
      });
      io.sockets.in(players[socket.id].teamPlayer).emit("wonGame", {
        player: players[players[socket.id].teamPlayer].id,
        won: false
      });
      setTimeout(() => {
        if (players[socket.id]) {
          players[socket.id].state = "start";
          socket.emit("changeState", "start");
          if (players[players[socket.id].teamPlayer]) {
            players[players[socket.id].teamPlayer].state = "start";
            io.sockets
              .in(players[socket.id].teamPlayer)
              .emit("changeState", "start");
          }
        }
      }, 4000);
    } else if (checkTie(socket.id)) {
      socket.emit("tieGame");
      io.sockets.in(players[socket.id].teamPlayer).emit("tieGame");
      setTimeout(() => {
        if (players[socket.id]) {
          players[socket.id].state = "start";
          socket.emit("changeState", "start");
          if (players[players[socket.id].teamPlayer]) {
            players[players[socket.id].teamPlayer].state = "start";
            io.sockets
              .in(players[socket.id].teamPlayer)
              .emit("changeState", "start");
          }
        }
      }, 4000);
    }
  });
});

server.listen(port, function() {
  pino.info(`listening on *: ${port}`);
});
