const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Base de Datos de palabras por categoría
const categorias = {
    anime_shonen: ["Goku", "Vegeta", "Naruto", "Sasuke", "Luffy", "Zoro", "Ichigo", "Gon", "Killua", "Deku", "Bakugo", "Tanjiro", "Nezuko", "Itadori", "Gojo", "Eren Yeager", "Levi"],
    anime_seinen: ["Guts", "Griffith", "Spike Spiegel", "Motoko", "Saitama", "Mob", "Light Yagami", "L", "Edward Elric", "Kaneki", "Shinji Ikari"],
    anime_isekai: ["Kirito", "Asuna", "Rimuru", "Ainz", "Subaru", "Aqua", "Megumin", "Naofumi"],
    videojuegos: ["Kratos", "Ellie", "Master Chief", "Samus", "Mario", "Link", "Zelda", "Cloud", "Solid Snake", "Lara Croft", "Geralt", "Arthur Morgan", "Sonic", "Pikachu", "Steve"],
    peliculas: ["Darth Vader", "Luke", "Joker", "Batman", "Thanos", "Iron Man", "Spider-Man", "Neo", "John Wick", "Jack Sparrow", "Harry Potter", "Terminator", "Rocky"]
};

const salas = {};

io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    // Unirse a una sala
    socket.on('unirseSala', ({ nombre, sala }) => {
        socket.join(sala);
        
        if (!salas[sala]) {
            salas[sala] = {
                jugadores: [],
                partidaActiva: false,
                rondaActual: 1,
                impostorId: null,
                palabraSecreta: null,
                categoriaActual: null,
                palabrasEnviadas: {},
                votos: {},
                eliminados: []
            };
        }
        
        salas[sala].jugadores.push({ id: socket.id, nombre: nombre });
        io.to(sala).emit('actualizarJugadores', salas[sala].jugadores);
    });

    // Iniciar partida
    socket.on('iniciarJuego', ({ sala, categoria }) => {
        const salaData = salas[sala];
        
        if (!salaData || salaData.jugadores.length < 3) {
            socket.emit('error', 'Se necesitan al menos 3 jugadores');
            return;
        }
        
        if (salaData.partidaActiva) return;
        
        // Reiniciar estado del juego
        salaData.partidaActiva = true;
        salaData.rondaActual = 1;
        salaData.palabrasEnviadas = {};
        salaData.votos = {};
        salaData.eliminados = [];
        salaData.categoriaActual = categoria;
        
        // Elegir palabra secreta
        const palabras = categorias[categoria];
        salaData.palabraSecreta = palabras[Math.floor(Math.random() * palabras.length)];
        
        // Elegir impostor (jugador activo no eliminado)
        const jugadoresActivos = salaData.jugadores.filter(j => !salaData.eliminados.includes(j.id));
        const impostorIndex = Math.floor(Math.random() * jugadoresActivos.length);
        salaData.impostorId = jugadoresActivos[impostorIndex].id;
        
        // Asignar roles
        salaData.jugadores.forEach(jugador => {
            if (jugador.id === salaData.impostorId) {
                io.to(jugador.id).emit('recibirRol', {
                    esImpostor: true,
                    categoria: categoria,
                    ronda: salaData.rondaActual
                });
            } else if (!salaData.eliminados.includes(jugador.id)) {
                io.to(jugador.id).emit('recibirRol', {
                    esImpostor: false,
                    palabra: salaData.palabraSecreta,
                    categoria: categoria,
                    ronda: salaData.rondaActual
                });
            }
        });
        
        // Iniciar fase de escritura
        setTimeout(() => {
            iniciarFaseEscritura(sala);
        }, 3000);
    });
    
    // Recibir palabra del jugador
    socket.on('enviarPalabra', ({ sala, palabra }) => {
        const salaData = salas[sala];
        
        if (!salaData || !salaData.partidaActiva) return;
        
        salaData.palabrasEnviadas[socket.id] = palabra;
        
        // Verificar si todos los jugadores activos han enviado su palabra
        const jugadoresActivos = salaData.jugadores.filter(j => !salaData.eliminados.includes(j.id));
        
        if (Object.keys(salaData.palabrasEnviadas).length === jugadoresActivos.length) {
            iniciarFaseVotacion(sala);
        }
    });
    
    // Recibir voto
    socket.on('enviarVoto', ({ sala, votoParaId }) => {
        const salaData = salas[sala];
        
        if (!salaData || !salaData.partidaActiva) return;
        
        salaData.votos[socket.id] = votoParaId;
        
        // Verificar si todos los jugadores activos han votado
        const jugadoresActivos = salaData.jugadores.filter(j => !salaData.eliminados.includes(j.id));
        
        if (Object.keys(salaData.votos).length === jugadoresActivos.length) {
            procesarEliminacion(sala);
        }
    });
    
    socket.on('disconnect', () => {
        for (const sala in salas) {
            const salaData = salas[sala];
            const jugadorIndex = salaData.jugadores.findIndex(j => j.id === socket.id);
            
            if (jugadorIndex !== -1) {
                salaData.jugadores.splice(jugadorIndex, 1);
                io.to(sala).emit('actualizarJugadores', salaData.jugadores);
                
                // Si se desconecta el impostor, terminar partida
                if (salaData.impostorId === socket.id && salaData.partidaActiva) {
                    salaData.partidaActiva = false;
                    io.to(sala).emit('juegoTerminado', { ganador: 'tripulantes', motivo: 'El impostor abandonó la partida' });
                }
                
                break;
            }
        }
    });
});

function iniciarFaseEscritura(sala) {
    const salaData = salas[sala];
    
    if (!salaData || !salaData.partidaActiva) return;
    
    salaData.palabrasEnviadas = {};
    
    const jugadoresActivos = salaData.jugadores.filter(j => !salaData.eliminados.includes(j.id));
    
    jugadoresActivos.forEach(jugador => {
        io.to(jugador.id).emit('faseEscritura', {
            ronda: salaData.rondaActual,
            categoria: salaData.categoriaActual
        });
    });
}

function iniciarFaseVotacion(sala) {
    const salaData = salas[sala];
    
    if (!salaData || !salaData.partidaActiva) return;
    
    salaData.votos = {};
    
    const jugadoresActivos = salaData.jugadores.filter(j => !salaData.eliminados.includes(j.id));
    
    // Preparar lista de palabras para mostrar
    const palabrasLista = jugadoresActivos.map(jugador => ({
        id: jugador.id,
        nombre: jugador.nombre,
        palabra: salaData.palabrasEnviadas[jugador.id]
    }));
    
    jugadoresActivos.forEach(jugador => {
        io.to(jugador.id).emit('faseVotacion', {
            palabras: palabrasLista,
            ronda: salaData.rondaActual
        });
    });
}

function procesarEliminacion(sala) {
    const salaData = salas[sala];
    
    if (!salaData || !salaData.partidaActiva) return;
    
    // Contar votos
    const votosContados = {};
    for (const voto of Object.values(salaData.votos)) {
        votosContados[voto] = (votosContados[voto] || 0) + 1;
    }
    
    // Encontrar al más votado
    let maxVotos = 0;
    let eliminadoId = null;
    
    for (const [id, count] of Object.entries(votosContados)) {
        if (count > maxVotos) {
            maxVotos = count;
            eliminadoId = id;
        }
    }
    
    // Verificar si el eliminado es el impostor
    const esImpostor = (eliminadoId === salaData.impostorId);
    
    if (esImpostor) {
        // Los tripulantes ganan
        salaData.partidaActiva = false;
        io.to(sala).emit('juegoTerminado', { 
            ganador: 'tripulantes', 
            motivo: '¡El impostor ha sido descubierto y eliminado!',
            impostorNombre: salaData.jugadores.find(j => j.id === eliminadoId)?.nombre
        });
        return;
    }
    
    // Eliminar al jugador
    salaData.eliminados.push(eliminadoId);
    
    // Verificar si quedan suficientes jugadores
    const jugadoresActivos = salaData.jugadores.filter(j => !salaData.eliminados.includes(j.id));
    
    if (jugadoresActivos.length <= 2) {
        // Impostor gana por falta de jugadores
        salaData.partidaActiva = false;
        io.to(sala).emit('juegoTerminado', { 
            ganador: 'impostor', 
            motivo: '¡El impostor ha eliminado a suficientes tripulantes y ahora domina la nave!',
            impostorNombre: salaData.jugadores.find(j => j.id === salaData.impostorId)?.nombre
        });
        return;
    }
    
    // Avanzar a siguiente ronda
    salaData.rondaActual++;
    
    if (salaData.rondaActual > 3) {
        // El impostor sobrevivió 3 rondas
        salaData.partidaActiva = false;
        io.to(sala).emit('juegoTerminado', { 
            ganador: 'impostor', 
            motivo: '¡El impostor ha sobrevivido 3 rondas sin ser detectado!',
            impostorNombre: salaData.jugadores.find(j => j.id === salaData.impostorId)?.nombre
        });
        return;
    }
    
    // Notificar eliminación y pasar a siguiente ronda
    const eliminadoNombre = salaData.jugadores.find(j => j.id === eliminadoId)?.nombre;
    
    io.to(sala).emit('rondaSiguiente', {
        ronda: salaData.rondaActual,
        eliminado: eliminadoNombre,
        maxRondas: 3
    });
    
    // Iniciar nueva ronda de escritura
    setTimeout(() => {
        iniciarFaseEscritura(sala);
    }, 4000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 Servidor corriendo en puerto ${PORT}`));
