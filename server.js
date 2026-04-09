const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Mega Base de Datos PRO
const categorias = {
    anime_shonen: ["Goku", "Vegeta", "Naruto", "Sasuke", "Luffy", "Zoro", "Ichigo", "Gon", "Killua", "Deku", "Bakugo", "Tanjiro", "Nezuko", "Itadori", "Gojo", "Denji", "Eren Yeager", "Levi"],
    anime_seinen: ["Guts", "Griffith", "Spike Spiegel", "Motoko", "Saitama", "Mob", "Light Yagami", "L", "Edward Elric", "Kaneki", "Shinji Ikari"],
    anime_isekai: ["Kirito", "Asuna", "Rimuru", "Ainz", "Subaru", "Aqua", "Megumin", "Naofumi"],
    videojuegos: ["Kratos", "Ellie", "Master Chief", "Samus", "Mario", "Link", "Zelda", "Cloud", "Solid Snake", "Lara Croft", "Geralt", "Arthur Morgan", "Sonic", "Pikachu", "Steve"],
    peliculas: ["Darth Vader", "Luke", "Joker", "Batman", "Thanos", "Iron Man", "Spider-Man", "Neo", "John Wick", "Jack Sparrow", "Harry Potter", "Terminator", "Rocky"]
};

const salas = {};

io.on('connection', (socket) => {
    
    socket.on('unirseSala', ({ nombre, sala }) => {
        socket.join(sala);
        if (!salas[sala]) salas[sala] = [];
        
        salas[sala].push({ id: socket.id, nombre: nombre });
        io.to(sala).emit('actualizarJugadores', salas[sala]);
    });

    socket.on('iniciarJuego', ({ sala, categoria, numImpostores }) => {
        const jugadores = salas[sala];
        if (!jugadores || jugadores.length < 3) return;

        const palabras = categorias[categoria] || categorias['anime_shonen'];
        const palabraSecreta = palabras[Math.floor(Math.random() * palabras.length)];
        
        // Elegir Impostores sin repetir
        let impostoresIDs = [];
        while (impostoresIDs.length < numImpostores && impostoresIDs.length < jugadores.length - 1) {
            let randomIdx = Math.floor(Math.random() * jugadores.length);
            if (!impostoresIDs.includes(randomIdx)) {
                impostoresIDs.push(randomIdx);
            }
        }

        // Repartir roles
        jugadores.forEach((jugador, index) => {
            if (impostoresIDs.includes(index)) {
                io.to(jugador.id).emit('recibirRol', { esImpostor: true, numImpostores });
            } else {
                io.to(jugador.id).emit('recibirRol', { esImpostor: false, palabra: palabraSecreta });
            }
        });
        
        // Avisar a todos que empezó para que pongan su cronómetro
        io.to(sala).emit('juegoIniciado');
    });

    socket.on('disconnect', () => {
        for (const sala in salas) {
            salas[sala] = salas[sala].filter(j => j.id !== socket.id);
            io.to(sala).emit('actualizarJugadores', salas[sala]);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor PRO corriendo en puerto ${PORT}`));