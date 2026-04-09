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

// Nombres bonitos para mostrar a los jugadores
const nombresCategorias = {
    anime_shonen: "Anime: Shonen",
    anime_seinen: "Anime: Seinen/Clásicos",
    anime_isekai: "Anime: Isekai",
    videojuegos: "Videojuegos",
    peliculas: "Películas"
};

const salas = {};
const estadoJuego = {}; // Para llevar el control de rondas, palabras y votos

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
        
        let impostoresIDs = [];
        while (impostoresIDs.length < numImpostores && impostoresIDs.length < jugadores.length - 1) {
            let randomIdx = Math.floor(Math.random() * jugadores.length);
            if (!impostoresIDs.includes(jugadores[randomIdx].id)) {
                impostoresIDs.push(jugadores[randomIdx].id);
            }
        }

        // Crear el estado del juego para esta sala
        estadoJuego[sala] = {
            ronda: 1,
            categoriaFijada: nombresCategorias[categoria],
            palabraSecreta: palabraSecreta,
            impostores: impostoresIDs,
            vivos: jugadores.map(j => j.id),
            palabrasRonda: {},
            votosRonda: {}
        };

        // Repartir roles
        jugadores.forEach((jugador) => {
            const esImpostor = impostoresIDs.includes(jugador.id);
            io.to(jugador.id).emit('recibirRol', { 
                esImpostor: esImpostor, 
                categoria: nombresCategorias[categoria],
                palabra: esImpostor ? null : palabraSecreta 
            });
        });
    });

    // Recibir la palabra de cada jugador
    socket.on('enviarPalabra', ({ sala, palabra }) => {
        const juego = estadoJuego[sala];
        if (!juego || !juego.vivos.includes(socket.id)) return;

        juego.palabrasRonda[socket.id] = palabra;

        // Si todos los vivos ya enviaron su palabra, pasamos a votar
        if (Object.keys(juego.palabrasRonda).length === juego.vivos.length) {
            const listaPalabras = juego.vivos.map(id => {
                const jug = salas[sala].find(j => j.id === id);
                return { id: jug.id, nombre: jug.nombre, palabra: juego.palabrasRonda[id] };
            });
            io.to(sala).emit('faseVotacion', listaPalabras);
        }
    });

    // Recibir el voto de cada jugador
    socket.on('enviarVoto', ({ sala, idVotado }) => {
        const juego = estadoJuego[sala];
        if (!juego || !juego.vivos.includes(socket.id)) return;

        juego.votosRonda[socket.id] = idVotado;

        // Si todos los vivos ya votaron, calculamos al eliminado
        if (Object.keys(juego.votosRonda).length === juego.vivos.length) {
            calcularResultadoRonda(sala);
        }
    });

    function calcularResultadoRonda(sala) {
        const juego = estadoJuego[sala];
        
        // Contar votos
        const conteo = {};
        Object.values(juego.votosRonda).forEach(id => {
            conteo[id] = (conteo[id] || 0) + 1;
        });

        // Buscar quién tiene más votos
        let idEliminado = null;
        let maxVotos = 0;
        let empate = false;

        for (const [id, votos] of Object.entries(conteo)) {
            if (votos > maxVotos) {
                maxVotos = votos;
                idEliminado = id;
                empate = false;
            } else if (votos === maxVotos) {
                empate = true;
            }
        }

        let mensajeEliminado = "";

        if (empate || !idEliminado) {
            mensajeEliminado = "¡Hubo un empate! Nadie es eliminado esta ronda.";
        } else {
            const jugadorEliminado = salas[sala].find(j => j.id === idEliminado);
            mensajeEliminado = `${jugadorEliminado.nombre} fue eliminado.`;
            
            // Quitar de los vivos
            juego.vivos = juego.vivos.filter(id => id !== idEliminado);
            
            // Quitar de los impostores si lo era
            if (juego.impostores.includes(idEliminado)) {
                juego.impostores = juego.impostores.filter(id => id !== idEliminado);
                mensajeEliminado += " ¡Era un Impostor! 🔪";
            } else {
                mensajeEliminado += " Era un Tripulante inocente. 👨‍🚀";
            }
        }

        // Revisar condiciones de victoria
        if (juego.impostores.length === 0) {
            io.to(sala).emit('finJuego', { mensaje: "¡LOS TRIPULANTES GANAN! Han eliminado a todos los impostores.", palabra: juego.palabraSecreta });
            return;
        }

        if (juego.ronda >= 3) {
            io.to(sala).emit('finJuego', { mensaje: "¡LOS IMPOSTORES GANAN! Sobrevivieron las 3 rondas.", palabra: juego.palabraSecreta });
            return;
        }

        // Si el juego sigue, preparar siguiente ronda
        juego.ronda++;
        juego.palabrasRonda = {};
        juego.votosRonda = {};
        io.to(sala).emit('siguienteRonda', { ronda: juego.ronda, mensaje: mensajeEliminado });
    }

    socket.on('disconnect', () => {
        for (const sala in salas) {
            salas[sala] = salas[sala].filter(j => j.id !== socket.id);
            io.to(sala).emit('actualizarJugadores', salas[sala]);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Servidor PRO corriendo en puerto ${PORT}`));
