// Base de datos de planteles históricos de mundiales.
// Cada jugador: [nombre, posición (POR|DEF|MED|DEL), nivel 1-99]
// Los niveles son estimaciones propias para efectos del juego.

// código ISO del país para las banderas (los emoji de bandera no se ven en Windows)
const CC = {
  bra: 'br', ita: 'it', ned: 'nl', ger: 'de', arg: 'ar', fra: 'fr', esp: 'es', chi: 'cl', cro: 'hr',
  hun: 'hu', eng: 'gb-eng', por: 'pt', pol: 'pl', cam: 'cm', rom: 'ro', uru: 'uy', col: 'co', bel: 'be', mar: 'ma',
  swe: 'se', aut: 'at', sui: 'ch', nir: 'gb-nir', wal: 'gb-wls', prk: 'kp', mex: 'mx', per: 'pe',
  irl: 'ie', bul: 'bg', den: 'dk', tur: 'tr', kor: 'kr', usa: 'us', sen: 'sn', ukr: 'ua',
  gha: 'gh', par: 'py', crc: 'cr', rus: 'ru',
  // selecciones del Mundial 2026
  nor: 'no', sco: 'gb-sct', bos: 'ba', cze: 'cz', ecu: 'ec', alg: 'dz', cpv: 'cv',
  cod: 'cd', civ: 'ci', egy: 'eg', rsa: 'za', tun: 'tn', aus: 'au', irq: 'iq', irn: 'ir',
  jpn: 'jp', jor: 'jo', qat: 'qa', ksa: 'sa', uzb: 'uz', can: 'ca', cuw: 'cw', hai: 'ht',
  pan: 'pa', nzl: 'nz',
  // urs / gdr / tch / yug: países que ya no existen — sin bandera moderna equivalente
};

const DEFAULT_PUESTOS = {
  POR: ['POR'],
  DEF: ['DFC'],
  MED: ['MC'],
  DEL: ['DC'],
};

// El segundo número de cada puesto es un DELTA sobre el nivel base: 0 = rinde igual
// en ese puesto; negativo = rinde algo menos fuera de su posición natural (curado a
// mano para jugadores emblemáticos donde tiene sentido futbolístico).
const PUESTOS_ESPECIALES = {
  Krol: [['LI', 0], ['DFC', 0]],               // lateral y líbero de elite: igual en ambos
  Suurbier: [['LD', 0], ['MD', -1]],
  Rijsbergen: [['DFC', 0], ['LD', -1]],
  Israël: [['DFC', 0]],
  Israel: [['DFC', 0]],
  'Van Ierssel': [['DFC', 0], ['LD', -1]],
  Neeskens: [['MC', 0], ['MCD', 0], ['MCO', -1]],
  Cruyff: [['DC', 0], ['MCO', 0], ['EI', 0]],   // genial en cualquier puesto de ataque
  Rep: [['ED', 0], ['DC', -1]],
  Rensenbrink: [['EI', 0], ['DC', -1]],
  Perišić: [['MI', 0], ['EI', 0], ['ED', -1]],
  Mandžukić: [['DC', 0], ['ED', -1]],           // un '9' que de extremo rinde menos
  Modrić: [['MC', 0], ['MCO', 0], ['MCD', -1]],
  Brozović: [['MCD', 0], ['MC', 0]],
  Kovačić: [['MC', 0], ['MCD', 0]],
  Gvardiol: [['DFC', 0], ['LI', -1]],
  Juranović: [['LD', 0]],
  Sosa: [['LI', 0], ['MI', -1]],
};

export const PUESTO_LINEA = {
  POR: 'POR',
  LD: 'DEF', DFC: 'DEF', LI: 'DEF',
  MCD: 'MED', MC: 'MED', MCO: 'MED', MI: 'MED', MD: 'MED',
  EI: 'DEL', DC: 'DEL', ED: 'DEL',
};

function puestosPorOrden(pos, nivel, orden) {
  if (pos === 'POR') return [['POR', nivel]];
  if (pos === 'DEF') {
    const patron = [
      [['LD', nivel], ['DFC', nivel]],
      [['DFC', nivel]],
      [['LI', nivel], ['DFC', nivel]],
      [['LI', nivel]],
      [['LD', nivel]],
      [['DFC', nivel]],
      [['LI', nivel], ['DFC', nivel]],
      [['LD', nivel], ['DFC', nivel]],
    ];
    return patron[orden % patron.length];
  }
  if (pos === 'MED') {
    const patron = [
      [['MCD', nivel], ['MC', nivel]],
      [['MC', nivel]],
      [['MCO', nivel], ['MC', nivel]],
      [['MI', nivel], ['MC', nivel]],
      [['MD', nivel], ['MC', nivel]],
      [['MC', nivel], ['MCD', nivel]],
      [['MCO', nivel], ['MD', nivel]],
      [['MCO', nivel], ['MI', nivel]],
    ];
    return patron[orden % patron.length];
  }
  if (pos === 'DEL') {
    const patron = [
      [['ED', nivel], ['DC', nivel]],
      [['DC', nivel]],
      [['EI', nivel], ['DC', nivel]],
      [['EI', nivel], ['ED', nivel]],
      [['DC', nivel]],
      [['ED', nivel]],
    ];
    return patron[orden % patron.length];
  }
  return (DEFAULT_PUESTOS[pos] || [pos]).map(p => [p, nivel]);
}

function normalizarPuestos(pos, nivel, puestos, nombre, orden = 0) {
  const especial = PUESTOS_ESPECIALES[nombre];
  const lista = puestos?.length
    ? puestos
    : especial
      ? especial.map(([puesto, delta]) => [puesto, nivel + delta])
      : puestosPorOrden(pos, nivel, orden);
  return lista.map(p => Array.isArray(p)
    ? { puesto: p[0], nivel: p[1] }
    : { puesto: p, nivel });
}

export function lineaDePuesto(puesto) {
  return PUESTO_LINEA[puesto] || puesto;
}

export function puestosJugador(jugador) {
  return jugador.puestos?.length ? jugador.puestos : normalizarPuestos(jugador.pos, jugador.nivel, null, jugador.nombre);
}

export function nivelEnPuesto(jugador, puesto) {
  return puestosJugador(jugador).find(p => p.puesto === puesto)?.nivel ?? null;
}

function squad(key, pais, anio, flag, apodo, color1, color2, jugadores) {
  const ordenPorPos = {};
  return {
    key, pais, anio, flag, apodo, color1, color2,
    cc: CC[key.slice(0, 3)],
    jugadores: jugadores.map(([nombre, pos, nivel, puestos], i) => {
      const orden = ordenPorPos[pos] ?? 0;
      ordenPorPos[pos] = orden + 1;
      return {
        id: key + '-' + i, nombre, pos, nivel,
        puestos: normalizarPuestos(pos, nivel, puestos, nombre, orden),
      };
    }),
  };
}

// bandera como imagen (compatible con Windows)
export function bandera(squadObj, alto = 15) {
  if (!squadObj?.cc) return '';
  const ancho = Math.round(alto * 4 / 3);
  return `<img class="bandera" width="${ancho}" height="${alto}" alt=""
    src="https://flagcdn.com/${ancho}x${alto}/${squadObj.cc}.png"
    srcset="https://flagcdn.com/${ancho * 2}x${alto * 2}/${squadObj.cc}.png 2x">`;
}

export const SQUADS = [
  squad('bra1970', 'Brasil', 1970, '🇧🇷', 'O Esquadrão de Ouro', '#FFD700', '#1B7A3D', [
    ['Félix', 'POR', 71], ['Ado', 'POR', 63],
    ['Carlos Alberto', 'DEF', 92], ['Brito', 'DEF', 82], ['Piazza', 'DEF', 81],
    ['Everaldo', 'DEF', 78], ['Marco Antônio', 'DEF', 73], ['Fontana', 'DEF', 70],
    ['Zé Maria', 'DEF', 74], ['Baldocchi', 'DEF', 66],
    ['Clodoaldo', 'MED', 86], ['Gérson', 'MED', 92], ['Rivellino', 'MED', 93],
    ['Paulo Cézar Caju', 'MED', 80],
    ['Jairzinho', 'DEL', 94], ['Tostão', 'DEL', 91], ['Pelé', 'DEL', 99],
    ['Edu', 'DEL', 76], ['Roberto', 'DEL', 70], ['Dadá Maravilha', 'DEL', 72],
  ]),
  squad('ita1970', 'Italia', 1970, '🇮🇹', 'Gli Azzurri del 4-3', '#1A60A8', '#FFFFFF', [
    ['Albertosi', 'POR', 85], ['Zoff', 'POR', 84],
    ['Burgnich', 'DEF', 86], ['Facchetti', 'DEF', 90], ['Cera', 'DEF', 78],
    ['Rosato', 'DEF', 79], ['Niccolai', 'DEF', 68], ['Poletti', 'DEF', 70],
    ['Bertini', 'MED', 78], ['Domenghini', 'MED', 80], ['Mazzola', 'MED', 90],
    ['Rivera', 'MED', 91], ['De Sisti', 'MED', 82], ['Juliano', 'MED', 74], ['Furino', 'MED', 72],
    ['Boninsegna', 'DEL', 87], ['Riva', 'DEL', 92], ['Prati', 'DEL', 78], ['Gori', 'DEL', 72],
  ]),
  squad('ned1974', 'Holanda', 1974, '🇳🇱', 'La Naranja Mecánica', '#F36C21', '#FFFFFF', [
    ['Jongbloed', 'POR', 73], ['Schrijvers', 'POR', 70],
    ['Suurbier', 'DEF', 82], ['Rijsbergen', 'DEF', 78], ['Krol', 'DEF', 89], ['Israël', 'DEF', 76],
    ['Haan', 'MED', 84], ['Jansen', 'MED', 82], ['Van Hanegem', 'MED', 88],
    ['Neeskens', 'MED', 91], ['R. van de Kerkhof', 'MED', 78], ['W. van de Kerkhof', 'MED', 76],
    ['T. de Jong', 'MED', 72],
    ['Rep', 'DEL', 85], ['Cruyff', 'DEL', 98], ['Rensenbrink', 'DEL', 88], ['Keizer', 'DEL', 80],
  ]),
  squad('ger1974', 'Alemania', 1974, '🇩🇪', 'Die Mannschaft del 74', '#FFFFFF', '#111111', [
    ['Maier', 'POR', 92], ['Kleff', 'POR', 70],
    ['Vogts', 'DEF', 86], ['Schwarzenbeck', 'DEF', 80], ['Beckenbauer', 'DEF', 97],
    ['Breitner', 'DEF', 90], ['Höttges', 'DEF', 72],
    ['Bonhof', 'MED', 85], ['Hoeneß', 'MED', 83], ['Overath', 'MED', 87],
    ['Netzer', 'MED', 86], ['Flohe', 'MED', 75], ['Cullmann', 'MED', 74],
    ['Grabowski', 'DEL', 80], ['G. Müller', 'DEL', 96], ['Hölzenbein', 'DEL', 79], ['Heynckes', 'DEL', 82],
  ]),
  squad('arg1978', 'Argentina', 1978, '🇦🇷', 'Los de Menotti', '#75AADB', '#FFFFFF', [
    ['Fillol', 'POR', 90], ['Baley', 'POR', 70],
    ['Olguín', 'DEF', 78], ['Galván', 'DEF', 80], ['Passarella', 'DEF', 91],
    ['Tarantini', 'DEF', 79], ['Killer', 'DEF', 70],
    ['Ardiles', 'MED', 88], ['Gallego', 'MED', 82], ['Valencia', 'MED', 76],
    ['Alonso', 'MED', 78], ['Larrosa', 'MED', 75], ['Villa', 'MED', 72],
    ['Kempes', 'DEL', 95], ['Luque', 'DEL', 86], ['Bertoni', 'DEL', 83],
    ['Houseman', 'DEL', 80], ['Ortiz', 'DEL', 74],
  ]),
  squad('bra1982', 'Brasil', 1982, '🇧🇷', 'La Belleza Trágica', '#FFD700', '#1B7A3D', [
    ['Waldir Peres', 'POR', 72], ['Paulo Sérgio', 'POR', 66],
    ['Leandro', 'DEF', 86], ['Oscar', 'DEF', 82], ['Luizinho', 'DEF', 78],
    ['Júnior', 'DEF', 88], ['Edevaldo', 'DEF', 72], ['Edinho', 'DEF', 76],
    ['Cerezo', 'MED', 88], ['Falcão', 'MED', 92], ['Sócrates', 'MED', 94],
    ['Zico', 'MED', 96], ['Paulo Isidoro', 'MED', 76], ['Dirceu', 'MED', 80], ['Batista', 'MED', 75],
    ['Éder', 'DEL', 87], ['Serginho', 'DEL', 74], ['Roberto Dinamite', 'DEL', 80], ['Careca', 'DEL', 78],
  ]),
  squad('ita1982', 'Italia', 1982, '🇮🇹', 'Los de Bearzot', '#1A60A8', '#FFFFFF', [
    ['Zoff', 'POR', 93], ['Bordon', 'POR', 76],
    ['Gentile', 'DEF', 88], ['Scirea', 'DEF', 92], ['Collovati', 'DEF', 80],
    ['Cabrini', 'DEF', 86], ['Bergomi', 'DEF', 82], ['Vierchowod', 'DEF', 80],
    ['Oriali', 'MED', 78], ['Tardelli', 'MED', 90], ['Antognoni', 'MED', 86],
    ['Conti', 'MED', 88], ['Marini', 'MED', 74], ['Dossena', 'MED', 72],
    ['Rossi', 'DEL', 93], ['Graziani', 'DEL', 80], ['Altobelli', 'DEL', 84], ['Causio', 'DEL', 78],
  ]),
  squad('arg1986', 'Argentina', 1986, '🇦🇷', 'La del Diego', '#75AADB', '#FFFFFF', [
    ['Pumpido', 'POR', 80], ['Islas', 'POR', 74],
    ['Cuciuffo', 'DEF', 78], ['Brown', 'DEF', 84], ['Ruggeri', 'DEF', 88],
    ['Garré', 'DEF', 74], ['Clausen', 'DEF', 73], ['Olarticoechea', 'DEF', 80],
    ['Giusti', 'MED', 79], ['Batista', 'MED', 80], ['Burruchaga', 'MED', 87],
    ['Enrique', 'MED', 82], ['Maradona', 'MED', 99], ['Borghi', 'MED', 76], ['Bochini', 'MED', 78],
    ['Valdano', 'DEL', 88], ['Pasculli', 'DEL', 76], ['Tapia', 'DEL', 70], ['Almirón', 'DEL', 68],
  ]),
  squad('fra1986', 'Francia', 1986, '🇫🇷', 'Le Carré Magique', '#1B3D8F', '#FFFFFF', [
    ['Bats', 'POR', 84], ['Rust', 'POR', 70],
    ['Amoros', 'DEF', 85], ['Battiston', 'DEF', 82], ['Bossis', 'DEF', 83],
    ['Ayache', 'DEF', 74], ['Le Roux', 'DEF', 76],
    ['Fernández', 'MED', 84], ['Giresse', 'MED', 90], ['Tigana', 'MED', 91],
    ['Platini', 'MED', 97], ['Genghini', 'MED', 75], ['Vercruysse', 'MED', 73],
    ['Papin', 'DEL', 84], ['Stopyra', 'DEL', 80], ['Rocheteau', 'DEL', 82],
    ['Bellone', 'DEL', 76], ['Ferreri', 'DEL', 74],
  ]),
  squad('ger1990', 'Alemania', 1990, '🇩🇪', 'Los de Beckenbauer', '#FFFFFF', '#111111', [
    ['Illgner', 'POR', 84], ['Aumann', 'POR', 72],
    ['Berthold', 'DEF', 80], ['Kohler', 'DEF', 88], ['Augenthaler', 'DEF', 86],
    ['Buchwald', 'DEF', 85], ['Brehme', 'DEF', 90], ['Reuter', 'DEF', 78], ['Pflügler', 'DEF', 72],
    ['Häßler', 'MED', 84], ['Matthäus', 'MED', 96], ['Möller', 'MED', 80],
    ['Littbarski', 'MED', 82], ['Thon', 'MED', 78], ['Bein', 'MED', 74],
    ['Völler', 'DEL', 88], ['Klinsmann', 'DEL', 89], ['Riedle', 'DEL', 78],
  ]),
  squad('bra1994', 'Brasil', 1994, '🇧🇷', 'El Tetra', '#FFD700', '#1B7A3D', [
    ['Taffarel', 'POR', 86], ['Zetti', 'POR', 74],
    ['Jorginho', 'DEF', 84], ['Aldair', 'DEF', 86], ['Márcio Santos', 'DEF', 82],
    ['Branco', 'DEF', 80], ['Leonardo', 'DEF', 82], ['Cafú', 'DEF', 84], ['Ronaldão', 'DEF', 74],
    ['Mauro Silva', 'MED', 85], ['Dunga', 'MED', 87], ['Zinho', 'MED', 80],
    ['Mazinho', 'MED', 78], ['Raí', 'MED', 82],
    ['Bebeto', 'DEL', 90], ['Romário', 'DEL', 96], ['Müller', 'DEL', 78], ['Viola', 'DEL', 73],
  ]),
  squad('ita1994', 'Italia', 1994, '🇮🇹', 'Los de Sacchi', '#1A60A8', '#FFFFFF', [
    ['Pagliuca', 'POR', 85], ['Marchegiani', 'POR', 76],
    ['Maldini', 'DEF', 93], ['Baresi', 'DEF', 94], ['Costacurta', 'DEF', 87],
    ['Benarrivo', 'DEF', 78], ['Mussi', 'DEF', 74], ['Apolloni', 'DEF', 73],
    ['Albertini', 'MED', 85], ['D. Baggio', 'MED', 80], ['Donadoni', 'MED', 84],
    ['Berti', 'MED', 78], ['Conte', 'MED', 80], ['Evani', 'MED', 74],
    ['R. Baggio', 'DEL', 96], ['Signori', 'DEL', 84], ['Casiraghi', 'DEL', 78],
    ['Massaro', 'DEL', 82], ['Zola', 'DEL', 84],
  ]),
  squad('fra1998', 'Francia', 1998, '🇫🇷', 'Les Bleus del 98', '#1B3D8F', '#FFFFFF', [
    ['Barthez', 'POR', 87], ['Lama', 'POR', 78],
    ['Thuram', 'DEF', 91], ['Blanc', 'DEF', 89], ['Desailly', 'DEF', 92],
    ['Lizarazu', 'DEF', 87], ['Leboeuf', 'DEF', 80], ['Candela', 'DEF', 78],
    ['Deschamps', 'MED', 88], ['Petit', 'MED', 85], ['Vieira', 'MED', 84],
    ['Karembeu', 'MED', 78], ['Zidane', 'MED', 97], ['Djorkaeff', 'MED', 86], ['Pirès', 'MED', 82],
    ['Henry', 'DEL', 85], ['Trezeguet', 'DEL', 80], ['Guivarc\'h', 'DEL', 72],
    ['Dugarry', 'DEL', 76], ['Diomède', 'DEL', 70],
  ]),
  squad('bra1998', 'Brasil', 1998, '🇧🇷', 'Los de Zagallo', '#FFD700', '#1B7A3D', [
    ['Taffarel', 'POR', 84], ['Dida', 'POR', 76],
    ['Cafú', 'DEF', 90], ['Júnior Baiano', 'DEF', 78], ['Aldair', 'DEF', 85],
    ['Roberto Carlos', 'DEF', 92], ['Gonçalves', 'DEF', 74], ['Zé Carlos', 'DEF', 70],
    ['Dunga', 'MED', 85], ['César Sampaio', 'MED', 80], ['Leonardo', 'MED', 84],
    ['Rivaldo', 'MED', 93], ['Denílson', 'MED', 82], ['Emerson', 'MED', 78], ['Zé Roberto', 'MED', 79],
    ['Ronaldo', 'DEL', 97], ['Bebeto', 'DEL', 84], ['Edmundo', 'DEL', 80],
  ]),
  squad('ned1998', 'Holanda', 1998, '🇳🇱', 'La Naranja del 98', '#F36C21', '#FFFFFF', [
    ['Van der Sar', 'POR', 87], ['Hoekstra', 'POR', 70],
    ['Reiziger', 'DEF', 80], ['Stam', 'DEF', 90], ['F. de Boer', 'DEF', 86],
    ['Numan', 'DEF', 80], ['Bogarde', 'DEF', 72],
    ['Davids', 'MED', 88], ['Seedorf', 'MED', 86], ['Cocu', 'MED', 82],
    ['R. de Boer', 'MED', 80], ['Jonk', 'MED', 76], ['Winter', 'MED', 74], ['Zenden', 'MED', 78],
    ['Bergkamp', 'DEL', 94], ['Kluivert', 'DEL', 88], ['Overmars', 'DEL', 86],
    ['Hasselbaink', 'DEL', 78], ['Van Hooijdonk', 'DEL', 76],
  ]),
  squad('bra2002', 'Brasil', 2002, '🇧🇷', 'El Penta', '#FFD700', '#1B7A3D', [
    ['Marcos', 'POR', 85], ['Dida', 'POR', 80],
    ['Cafú', 'DEF', 90], ['Lúcio', 'DEF', 87], ['Roque Júnior', 'DEF', 78],
    ['Edmílson', 'DEF', 82], ['Roberto Carlos', 'DEF', 91], ['Belletti', 'DEF', 76],
    ['Anderson Polga', 'DEF', 72], ['Júnior', 'DEF', 74],
    ['Gilberto Silva', 'MED', 84], ['Kléberson', 'MED', 80], ['Juninho Paulista', 'MED', 78],
    ['Ronaldinho', 'MED', 94], ['Rivaldo', 'MED', 93], ['Vampeta', 'MED', 74],
    ['Ronaldo', 'DEL', 97], ['Denílson', 'DEL', 78], ['Edílson', 'DEL', 76], ['Luizão', 'DEL', 72],
  ]),
  squad('ita2006', 'Italia', 2006, '🇮🇹', 'Los de Lippi', '#1A60A8', '#FFFFFF', [
    ['Buffon', 'POR', 95], ['Peruzzi', 'POR', 78],
    ['Zambrotta', 'DEF', 88], ['Cannavaro', 'DEF', 95], ['Materazzi', 'DEF', 84],
    ['Nesta', 'DEF', 92], ['Grosso', 'DEF', 82], ['Zaccardo', 'DEF', 72], ['Oddo', 'DEF', 76],
    ['Pirlo', 'MED', 93], ['Gattuso', 'MED', 87], ['De Rossi', 'MED', 84],
    ['Camoranesi', 'MED', 82], ['Perrotta', 'MED', 80], ['Totti', 'MED', 92],
    ['Del Piero', 'DEL', 89], ['Toni', 'DEL', 85], ['Gilardino', 'DEL', 80],
    ['Inzaghi', 'DEL', 82], ['Iaquinta', 'DEL', 76],
  ]),
  squad('fra2006', 'Francia', 2006, '🇫🇷', 'La Última de Zizou', '#1B3D8F', '#FFFFFF', [
    ['Barthez', 'POR', 82], ['Coupet', 'POR', 80],
    ['Sagnol', 'DEF', 84], ['Thuram', 'DEF', 88], ['Gallas', 'DEF', 86],
    ['Abidal', 'DEF', 84], ['Boumsong', 'DEF', 74], ['Silvestre', 'DEF', 76],
    ['Makélélé', 'MED', 89], ['Vieira', 'MED', 88], ['Zidane', 'MED', 95],
    ['Ribéry', 'MED', 85], ['Malouda', 'MED', 82], ['Dhorasoo', 'MED', 70],
    ['Henry', 'DEL', 93], ['Trezeguet', 'DEL', 84], ['Wiltord', 'DEL', 78],
    ['Saha', 'DEL', 76], ['Govou', 'DEL', 74],
  ]),
  squad('esp2010', 'España', 2010, '🇪🇸', 'La Roja del Tiki-Taka', '#C8102E', '#FFC400', [
    ['Casillas', 'POR', 93], ['Valdés', 'POR', 84], ['Reina', 'POR', 84],
    ['Ramos', 'DEF', 89], ['Piqué', 'DEF', 90], ['Puyol', 'DEF', 91],
    ['Capdevila', 'DEF', 80], ['Arbeloa', 'DEF', 78], ['Marchena', 'DEF', 76],
    ['Busquets', 'MED', 88], ['Xabi Alonso', 'MED', 89], ['Xavi', 'MED', 96],
    ['Iniesta', 'MED', 95], ['Cesc Fàbregas', 'MED', 87], ['Silva', 'MED', 87], ['Mata', 'MED', 80],
    ['Villa', 'DEL', 92], ['Torres', 'DEL', 86], ['Pedro', 'DEL', 82],
    ['Llorente', 'DEL', 78], ['Navas', 'DEL', 80],
  ]),
  squad('ned2010', 'Holanda', 2010, '🇳🇱', 'La Naranja del 2010', '#F36C21', '#FFFFFF', [
    ['Stekelenburg', 'POR', 82], ['Vorm', 'POR', 74],
    ['Van der Wiel', 'DEF', 78], ['Heitinga', 'DEF', 80], ['Mathijsen', 'DEF', 78],
    ['Van Bronckhorst', 'DEF', 82], ['Boulahrouz', 'DEF', 72], ['Ooijer', 'DEF', 72],
    ['Van Bommel', 'MED', 84], ['N. de Jong', 'MED', 82], ['Sneijder', 'MED', 92],
    ['Van der Vaart', 'MED', 84], ['Afellay', 'MED', 76],
    ['Robben', 'DEL', 93], ['Kuyt', 'DEL', 84], ['Van Persie', 'DEL', 88],
    ['Huntelaar', 'DEL', 80], ['Elia', 'DEL', 76],
  ]),
  squad('chi2010', 'Chile', 2010, '🇨🇱', 'Los de Bielsa', '#D52B1E', '#1B3D8F', [
    ['Bravo', 'POR', 84], ['Pinto', 'POR', 70],
    ['Isla', 'DEF', 80], ['Medel', 'DEF', 84], ['Ponce', 'DEF', 78],
    ['Jara', 'DEF', 78], ['Contreras', 'DEF', 72], ['Fuentes', 'DEF', 74],
    ['Vidal', 'MED', 85], ['Carmona', 'MED', 78], ['Millar', 'MED', 76],
    ['M. Fernández', 'MED', 82], ['Valdivia', 'MED', 84], ['Mark González', 'MED', 78],
    ['Beausejour', 'MED', 80],
    ['Alexis Sánchez', 'DEL', 87], ['Suazo', 'DEL', 82], ['Paredes', 'DEL', 76], ['Orellana', 'DEL', 76],
  ]),
  squad('ger2014', 'Alemania', 2014, '🇩🇪', 'Los del 7-1', '#FFFFFF', '#111111', [
    ['Neuer', 'POR', 94], ['Weidenfeller', 'POR', 78],
    ['Lahm', 'DEF', 92], ['Boateng', 'DEF', 88], ['Hummels', 'DEF', 89],
    ['Höwedes', 'DEF', 80], ['Mertesacker', 'DEF', 82], ['Durm', 'DEF', 72], ['Ginter', 'DEF', 72],
    ['Schweinsteiger', 'MED', 89], ['Khedira', 'MED', 84], ['Kroos', 'MED', 91],
    ['Özil', 'MED', 88], ['Götze', 'MED', 85], ['Draxler', 'MED', 80], ['Kramer', 'MED', 74],
    ['T. Müller', 'DEL', 90], ['Klose', 'DEL', 87], ['Schürrle', 'DEL', 82], ['Podolski', 'DEL', 80],
  ]),
  squad('arg2014', 'Argentina', 2014, '🇦🇷', 'Los de Brasil 2014', '#75AADB', '#FFFFFF', [
    ['Romero', 'POR', 82], ['Orión', 'POR', 74],
    ['Zabaleta', 'DEF', 84], ['Garay', 'DEF', 84], ['F. Fernández', 'DEF', 78],
    ['Demichelis', 'DEF', 78], ['Rojo', 'DEF', 80], ['Basanta', 'DEF', 72],
    ['Mascherano', 'MED', 89], ['Biglia', 'MED', 80], ['Gago', 'MED', 78],
    ['Di María', 'MED', 89], ['Enzo Pérez', 'MED', 76],
    ['Messi', 'DEL', 98], ['Agüero', 'DEL', 88], ['Higuaín', 'DEL', 86],
    ['Lavezzi', 'DEL', 82], ['Palacio', 'DEL', 78],
  ]),
  squad('chi2014', 'Chile', 2014, '🇨🇱', 'La Generación Dorada', '#D52B1E', '#1B3D8F', [
    ['Bravo', 'POR', 86], ['Herrera', 'POR', 74],
    ['Isla', 'DEF', 82], ['Medel', 'DEF', 86], ['Silva', 'DEF', 76],
    ['Jara', 'DEF', 80], ['Mena', 'DEF', 78], ['Albornoz', 'DEF', 74],
    ['Díaz', 'MED', 84], ['Aránguiz', 'MED', 84], ['Vidal', 'MED', 90],
    ['Valdivia', 'MED', 82], ['Beausejour', 'MED', 78], ['Gutiérrez', 'MED', 76],
    ['M. Fernández', 'MED', 78],
    ['Alexis Sánchez', 'DEL', 91], ['Vargas', 'DEL', 82], ['Pinilla', 'DEL', 78], ['Paredes', 'DEL', 74],
  ]),
  squad('fra2018', 'Francia', 2018, '🇫🇷', 'Les Bleus de Rusia', '#1B3D8F', '#FFFFFF', [
    ['Lloris', 'POR', 88], ['Mandanda', 'POR', 78],
    ['Pavard', 'DEF', 82], ['Varane', 'DEF', 90], ['Umtiti', 'DEF', 86],
    ['L. Hernández', 'DEF', 86], ['Sidibé', 'DEF', 76], ['Kimpembe', 'DEF', 78],
    ['Kanté', 'MED', 92], ['Pogba', 'MED', 89], ['Matuidi', 'MED', 84],
    ['Tolisso', 'MED', 78], ['Nzonzi', 'MED', 76], ['Lemar', 'MED', 78],
    ['Mbappé', 'DEL', 92], ['Griezmann', 'DEL', 91], ['Giroud', 'DEL', 84],
    ['Dembélé', 'DEL', 80], ['Fekir', 'DEL', 78], ['Thauvin', 'DEL', 76],
  ]),
  squad('cro2018', 'Croacia', 2018, '🇭🇷', 'Los del Ajedrez', '#D52B1E', '#FFFFFF', [
    ['Subašić', 'POR', 84], ['Livaković', 'POR', 74],
    ['Vrsaljko', 'DEF', 80], ['Lovren', 'DEF', 82], ['Vida', 'DEF', 80],
    ['Strinić', 'DEF', 76], ['Ćorluka', 'DEF', 76], ['Jedvaj', 'DEF', 72],
    ['Modrić', 'MED', 95], ['Rakitić', 'MED', 88], ['Brozović', 'MED', 84],
    ['Kovačić', 'MED', 82], ['Badelj', 'MED', 76],
    ['Mandžukić', 'DEL', 86], ['Perišić', 'DEL', 86, [['MI', 86], ['EI', 86], ['ED', 86]]], ['Rebić', 'DEL', 80],
    ['Kramarić', 'DEL', 80], ['Kalinić', 'DEL', 74], ['Pjaca', 'DEL', 72],
  ]),
  squad('arg2022', 'Argentina', 2022, '🇦🇷', 'La Scaloneta', '#75AADB', '#FFFFFF', [
    ['Dibu Martínez', 'POR', 89], ['Armani', 'POR', 78],
    ['Molina', 'DEF', 82], ['C. Romero', 'DEF', 87], ['Otamendi', 'DEF', 84],
    ['Tagliafico', 'DEF', 80], ['Acuña', 'DEF', 82], ['Montiel', 'DEF', 78],
    ['L. Martínez', 'DEF', 84],
    ['De Paul', 'MED', 86], ['Enzo Fernández', 'MED', 87], ['Mac Allister', 'MED', 85],
    ['Paredes', 'MED', 80], ['G. Rodríguez', 'MED', 76],
    ['Messi', 'DEL', 97], ['Di María', 'DEL', 87], ['Julián Álvarez', 'DEL', 87],
    ['Lautaro Martínez', 'DEL', 84], ['Dybala', 'DEL', 82],
  ]),
  squad('fra2022', 'Francia', 2022, '🇫🇷', 'Les Bleus de Catar', '#1B3D8F', '#FFFFFF', [
    ['Lloris', 'POR', 85], ['Mandanda', 'POR', 76],
    ['Koundé', 'DEF', 86], ['Varane', 'DEF', 86], ['Upamecano', 'DEF', 83],
    ['Konaté', 'DEF', 82], ['T. Hernández', 'DEF', 84], ['Pavard', 'DEF', 78], ['Saliba', 'DEF', 78],
    ['Tchouaméni', 'MED', 85], ['Rabiot', 'MED', 83], ['Fofana', 'MED', 78],
    ['Veretout', 'MED', 74], ['Griezmann', 'MED', 89],
    ['Mbappé', 'DEL', 95], ['Giroud', 'DEL', 84], ['Dembélé', 'DEL', 84],
    ['Coman', 'DEL', 82], ['M. Thuram', 'DEL', 78], ['Kolo Muani', 'DEL', 80],
  ]),
  squad('hun1954', 'Hungría', 1954, '🇭🇺', 'El Equipo de Oro', '#CE2939', '#FFFFFF', [
    ['Grosics', 'POR', 86], ['Gellér', 'POR', 70],
    ['Buzánszky', 'DEF', 80], ['Lóránt', 'DEF', 82], ['Lantos', 'DEF', 80], ['Kárpáti', 'DEF', 74],
    ['Bozsik', 'MED', 90], ['Zakariás', 'MED', 80], ['Szojka', 'MED', 72], ['J. Tóth', 'MED', 74],
    ['Puskás', 'DEL', 97], ['Kocsis', 'DEL', 93], ['Hidegkuti', 'DEL', 92],
    ['Czibor', 'DEL', 89], ['Budai', 'DEL', 80], ['Palotás', 'DEL', 76],
  ]),
  squad('bra1958', 'Brasil', 1958, '🇧🇷', 'El Primero de Pelé', '#FFD700', '#1B7A3D', [
    ['Gilmar', 'POR', 85], ['Castilho', 'POR', 74],
    ['Djalma Santos', 'DEF', 87], ['Bellini', 'DEF', 80], ['Orlando', 'DEF', 79],
    ['Nilton Santos', 'DEF', 89], ['De Sordi', 'DEF', 75], ['Mauro', 'DEF', 76],
    ['Zito', 'MED', 83], ['Didi', 'MED', 91], ['Dino Sani', 'MED', 76], ['Moacir', 'MED', 72],
    ['Garrincha', 'DEL', 94], ['Vavá', 'DEL', 87], ['Pelé', 'DEL', 93],
    ['Zagallo', 'DEL', 84], ['Altafini', 'DEL', 80], ['Pepe', 'DEL', 76],
  ]),
  squad('eng1966', 'Inglaterra', 1966, '🏴', 'Los Campeones de Wembley', '#FFFFFF', '#1B3D8F', [
    ['Banks', 'POR', 90], ['Bonetti', 'POR', 78],
    ['Cohen', 'DEF', 78], ['J. Charlton', 'DEF', 82], ['Moore', 'DEF', 93],
    ['Wilson', 'DEF', 78], ['Armfield', 'DEF', 74],
    ['Stiles', 'MED', 78], ['B. Charlton', 'MED', 94], ['Ball', 'MED', 84],
    ['Peters', 'MED', 82], ['Eastham', 'MED', 72],
    ['Hurst', 'DEL', 86], ['Hunt', 'DEL', 80], ['Greaves', 'DEL', 88],
    ['Callaghan', 'DEL', 74], ['Connelly', 'DEL', 74],
  ]),
  squad('por1966', 'Portugal', 1966, '🇵🇹', 'La Pantera Negra', '#C8102E', '#006847', [
    ['José Pereira', 'POR', 78], ['Américo', 'POR', 70],
    ['Germano', 'DEF', 80], ['Vicente', 'DEF', 76], ['Hilário', 'DEF', 76],
    ['Morais', 'DEF', 74], ['Festa', 'DEF', 72], ['Baptista', 'DEF', 75],
    ['Coluna', 'MED', 88], ['Graça', 'MED', 80], ['Custódio', 'MED', 72],
    ['Eusébio', 'DEL', 95], ['Torres', 'DEL', 84], ['Simões', 'DEL', 83], ['José Augusto', 'DEL', 82],
  ]),
  squad('pol1974', 'Polonia', 1974, '🇵🇱', 'Las Águilas de Lato', '#FFFFFF', '#DC143C', [
    ['Tomaszewski', 'POR', 84], ['Kalinowski', 'POR', 70],
    ['Szymanowski', 'DEF', 78], ['Gorgoń', 'DEF', 82], ['Żmuda', 'DEF', 80], ['Musiał', 'DEF', 76],
    ['Kasperczak', 'MED', 78], ['Deyna', 'MED', 90], ['Maszczyk', 'MED', 74], ['Cmikiewicz', 'MED', 72],
    ['Lato', 'DEL', 89], ['Szarmach', 'DEL', 84], ['Gadocha', 'DEL', 80],
    ['Domarski', 'DEL', 76], ['Kapka', 'DEL', 70],
  ]),
  squad('cam1990', 'Camerún', 1990, '🇨🇲', 'Los Leones Indomables', '#007A5E', '#CE1126', [
    ['N\'Kono', 'POR', 84], ['Bell', 'POR', 76],
    ['Tataw', 'DEF', 74], ['Massing', 'DEF', 76], ['Kundé', 'DEF', 78],
    ['Ebwellé', 'DEF', 74], ['Onana', 'DEF', 72],
    ['M\'Bouh', 'MED', 76], ['Libiih', 'MED', 74], ['Mfédé', 'MED', 74],
    ['Maboang', 'MED', 70], ['Pagal', 'MED', 72],
    ['Milla', 'DEL', 88], ['Omam-Biyik', 'DEL', 82], ['Makanaky', 'DEL', 76],
  ]),
  squad('eng1990', 'Inglaterra', 1990, '🏴', 'Las Lágrimas de Gazza', '#FFFFFF', '#1B3D8F', [
    ['Shilton', 'POR', 88], ['Woods', 'POR', 76],
    ['Parker', 'DEF', 78], ['D. Walker', 'DEF', 80], ['Butcher', 'DEF', 80],
    ['Pearce', 'DEF', 82], ['Wright', 'DEF', 78], ['Dorigo', 'DEF', 74],
    ['Robson', 'MED', 86], ['Gascoigne', 'MED', 88], ['Platt', 'MED', 82],
    ['Waddle', 'MED', 83], ['McMahon', 'MED', 74], ['Steven', 'MED', 74],
    ['Lineker', 'DEL', 90], ['Beardsley', 'DEL', 82], ['Barnes', 'DEL', 84], ['Bull', 'DEL', 72],
  ]),
  squad('rom1994', 'Rumania', 1994, '🇷🇴', 'La Generación de Hagi', '#FFD700', '#002B7F', [
    ['Prunea', 'POR', 76], ['Stelea', 'POR', 76],
    ['Petrescu', 'DEF', 84], ['Belodedici', 'DEF', 84], ['Prodan', 'DEF', 80],
    ['Mihali', 'DEF', 76], ['Selymes', 'DEF', 74],
    ['Popescu', 'MED', 86], ['Hagi', 'MED', 93], ['Lupescu', 'MED', 78], ['Munteanu', 'MED', 80],
    ['Dumitrescu', 'DEL', 82], ['Răducioiu', 'DEL', 80], ['Vlădoiu', 'DEL', 70],
  ]),
  squad('uru2010', 'Uruguay', 2010, '🇺🇾', 'La Garra Charrúa', '#5CB8E4', '#1B1A17', [
    ['Muslera', 'POR', 82], ['Castillo', 'POR', 70],
    ['M. Pereira', 'DEF', 78], ['Lugano', 'DEF', 82], ['Godín', 'DEF', 85],
    ['Fucile', 'DEF', 76], ['Cáceres', 'DEF', 80], ['Victorino', 'DEF', 74],
    ['D. Pérez', 'MED', 78], ['Arévalo Ríos', 'MED', 78], ['A. Pereira', 'MED', 78],
    ['Eguren', 'MED', 74], ['A. Fernández', 'MED', 72],
    ['Forlán', 'DEL', 90], ['Suárez', 'DEL', 87], ['Cavani', 'DEL', 84], ['Abreu', 'DEL', 76],
  ]),
  squad('col2014', 'Colombia', 2014, '🇨🇴', 'Los Cafeteros', '#FCD116', '#003893', [
    ['Ospina', 'POR', 83], ['Mondragón', 'POR', 74],
    ['Zúñiga', 'DEF', 78], ['Zapata', 'DEF', 76], ['Yepes', 'DEF', 78],
    ['Armero', 'DEF', 76], ['Arias', 'DEF', 72],
    ['C. Sánchez', 'MED', 78], ['Aguilar', 'MED', 76], ['Cuadrado', 'MED', 84],
    ['James', 'MED', 90], ['Quintero', 'MED', 78], ['Mejía', 'MED', 70],
    ['T. Gutiérrez', 'DEL', 80], ['Bacca', 'DEL', 80], ['Ibarbo', 'DEL', 72], ['A. Ramos', 'DEL', 70],
  ]),
  squad('bel2018', 'Bélgica', 2018, '🇧🇪', 'Los Diablos Rojos', '#ED2939', '#1B1A17', [
    ['Courtois', 'POR', 90], ['Mignolet', 'POR', 78],
    ['Alderweireld', 'DEF', 84], ['Kompany', 'DEF', 85], ['Vertonghen', 'DEF', 84],
    ['Meunier', 'DEF', 80], ['Vermaelen', 'DEF', 76], ['Boyata', 'DEF', 72],
    ['Witsel', 'MED', 82], ['De Bruyne', 'MED', 93], ['Fellaini', 'MED', 80],
    ['Tielemans', 'MED', 78], ['M. Dembélé', 'MED', 78], ['Chadli', 'MED', 76], ['Carrasco', 'MED', 80],
    ['E. Hazard', 'DEL', 92], ['Lukaku', 'DEL', 87], ['Mertens', 'DEL', 84],
    ['Batshuayi', 'DEL', 78], ['Januzaj', 'DEL', 74],
  ]),
  squad('mar2022', 'Marruecos', 2022, '🇲🇦', 'Los Leones del Atlas', '#C1272D', '#006233', [
    ['Bono', 'POR', 86], ['Munir', 'POR', 72],
    ['Hakimi', 'DEF', 87], ['Saïss', 'DEF', 80], ['Aguerd', 'DEF', 82],
    ['Mazraoui', 'DEF', 80], ['Dari', 'DEF', 74], ['Attiyat-Allah', 'DEF', 76],
    ['Amrabat', 'MED', 85], ['Ounahi', 'MED', 80], ['Amallah', 'MED', 76], ['Sabiri', 'MED', 74],
    ['Ziyech', 'DEL', 84], ['En-Nesyri', 'DEL', 80], ['Boufal', 'DEL', 78],
    ['Aboukhlal', 'DEL', 74], ['Cheddira', 'DEL', 72], ['Hamdallah', 'DEL', 74],
  ]),
  // ---- todos los Chile mundialistas ----
  squad('chi1930', 'Chile', 1930, '🇨🇱', 'Los Pioneros del 30', '#D52B1E', '#1B3D8F', [
    ['Cortés', 'POR', 68],
    ['Poirier', 'DEF', 66], ['Chaparro', 'DEF', 64], ['Morales', 'DEF', 62], ['Riveros', 'DEF', 60],
    ['Saavedra', 'MED', 72], ['A. Torres', 'MED', 66], ['Elgueta', 'MED', 60],
    ['Subiabre', 'DEL', 74], ['Vidal', 'DEL', 70], ['Schneeberger', 'DEL', 68], ['Villalobos', 'DEL', 64],
  ]),
  squad('chi1950', 'Chile', 1950, '🇨🇱', 'Los del Maracaná', '#D52B1E', '#1B3D8F', [
    ['Livingstone', 'POR', 82],
    ['Farías', 'DEF', 68], ['Álvarez', 'DEF', 66], ['Roldán', 'DEF', 66], ['Busquets', 'DEF', 62],
    ['Cremaschi', 'MED', 82], ['E. Robledo', 'MED', 72], ['C. Rojas', 'MED', 64],
    ['G. Robledo', 'DEL', 84], ['Riera', 'DEL', 76], ['Infante', 'DEL', 70], ['G. Díaz', 'DEL', 66],
  ]),
  squad('chi1962', 'Chile', 1962, '🇨🇱', 'Los Terceros del Mundo', '#D52B1E', '#1B3D8F', [
    ['Escuti', 'POR', 78], ['Godoy', 'POR', 66],
    ['L. Eyzaguirre', 'DEF', 80], ['R. Sánchez', 'DEF', 78], ['Navarro', 'DEF', 76],
    ['C. Contreras', 'DEF', 74], ['J. Rodríguez', 'DEF', 70],
    ['Toro', 'MED', 86], ['E. Rojas', 'MED', 82], ['J. Ramírez', 'MED', 74],
    ['L. Sánchez', 'DEL', 88], ['Landa', 'DEL', 78], ['Fouilloux', 'DEL', 76], ['Tobar', 'DEL', 74],
  ]),
  squad('chi1966', 'Chile', 1966, '🇨🇱', 'Los de Inglaterra 66', '#D52B1E', '#1B3D8F', [
    ['Olivares', 'POR', 72],
    ['Figueroa', 'DEF', 80], ['Cruz', 'DEF', 72], ['Marcos', 'DEF', 70],
    ['Villanueva', 'DEF', 68], ['Berly', 'DEF', 66],
    ['I. Prieto', 'MED', 78], ['Yávar', 'MED', 72], ['Hormazábal', 'MED', 66],
    ['Araya', 'DEL', 80], ['L. Sánchez', 'DEL', 84], ['Landa', 'DEL', 76], ['Fouilloux', 'DEL', 74],
  ]),
  squad('chi1974', 'Chile', 1974, '🇨🇱', 'Los de Alemania 74', '#D52B1E', '#1B3D8F', [
    ['Vallejos', 'POR', 74],
    ['Figueroa', 'DEF', 92], ['Quintano', 'DEF', 82], ['Machuca', 'DEF', 74],
    ['Arias', 'DEF', 72], ['García', 'DEF', 68],
    ['Páez', 'MED', 76], ['Lara', 'MED', 70], ['Inostroza', 'MED', 68],
    ['Caszely', 'DEL', 84], ['Ahumada', 'DEL', 80], ['Véliz', 'DEL', 78], ['Castro', 'DEL', 70],
  ]),
  squad('chi1982', 'Chile', 1982, '🇨🇱', 'Los de España 82', '#D52B1E', '#1B3D8F', [
    ['Osbén', 'POR', 76],
    ['Figueroa', 'DEF', 84], ['Garrido', 'DEF', 72], ['Bigorra', 'DEF', 74],
    ['Soto', 'DEF', 70], ['Galindo', 'DEF', 70],
    ['Bonvallet', 'MED', 76], ['Dubó', 'MED', 74], ['Neira', 'MED', 76], ['Rivas', 'MED', 70],
    ['Caszely', 'DEL', 82], ['Yáñez', 'DEL', 80], ['Moscoso', 'DEL', 78], ['Letelier', 'DEL', 72],
  ]),
  squad('chi1998', 'Chile', 1998, '🇨🇱', 'Los del Za-Sa', '#D52B1E', '#1B3D8F', [
    ['Tapia', 'POR', 78],
    ['Margas', 'DEF', 82], ['Reyes', 'DEF', 78], ['Villarroel', 'DEF', 74],
    ['M. Ramírez', 'DEF', 74], ['Castañeda', 'DEF', 72],
    ['Sierra', 'MED', 82], ['Acuña', 'MED', 78], ['Estay', 'MED', 80],
    ['Musrri', 'MED', 72], ['Cornejo', 'MED', 70],
    ['Zamorano', 'DEL', 88], ['Salas', 'DEL', 88], ['Barrera', 'DEL', 74], ['Carreño', 'DEL', 68],
  ]),
  // ---- cuartofinalistas 1950 (grupo final) ----
  squad('uru1950', 'Uruguay', 1950, '🇺🇾', 'El Maracanazo', '#5CB8E4', '#1B1A17', [
    ['Máspoli', 'POR', 84],
    ['M. González', 'DEF', 74], ['Tejera', 'DEF', 74], ['Gambetta', 'DEF', 76], ['Andrade', 'DEF', 84],
    ['O. Varela', 'MED', 92], ['J. Pérez', 'MED', 78], ['Moreno', 'MED', 68],
    ['Ghiggia', 'DEL', 88], ['Schiaffino', 'DEL', 92], ['Míguez', 'DEL', 84], ['Vidal', 'DEL', 70],
  ]),
  squad('bra1950', 'Brasil', 1950, '🇧🇷', 'Los del Maracanazo', '#FFD700', '#1B7A3D', [
    ['Barbosa', 'POR', 80],
    ['Augusto', 'DEF', 74], ['Juvenal', 'DEF', 72], ['Bigode', 'DEF', 72], ['Eli', 'DEF', 64],
    ['Bauer', 'MED', 78], ['Danilo', 'MED', 76], ['Zizinho', 'MED', 92],
    ['Ademir', 'DEL', 92], ['Jair', 'DEL', 88], ['Chico', 'DEL', 80], ['Friaça', 'DEL', 78], ['Maneca', 'DEL', 72],
  ]),
  squad('swe1950', 'Suecia', 1950, '🇸🇪', 'Los Amateurs de Oro', '#FFCC00', '#0050A0', [
    ['Svensson', 'POR', 78],
    ['E. Nilsson', 'DEF', 76], ['Samuelsson', 'DEF', 68], ['K. Nordahl', 'DEF', 70],
    ['Palmér', 'MED', 76], ['Gärd', 'MED', 66], ['Jönsson', 'MED', 64], ['Andersson', 'DEF', 62],
    ['Jeppson', 'DEL', 84], ['Skoglund', 'DEL', 84], ['S. Nilsson', 'DEL', 72], ['Sundqvist', 'DEL', 68],
  ]),
  squad('esp1950', 'España', 1950, '🇪🇸', 'La Furia del 50', '#C8102E', '#FFC400', [
    ['Ramallets', 'POR', 82],
    ['Alonso', 'DEF', 72], ['Parra', 'DEF', 74], ['Gonzalvo', 'DEF', 74], ['Asensi', 'DEF', 66],
    ['Puchades', 'MED', 82], ['Panizo', 'MED', 78], ['Igoa', 'MED', 76],
    ['Zarra', 'DEL', 90], ['Basora', 'DEL', 82], ['Gaínza', 'DEL', 84], ['Molowny', 'DEL', 76], ['César', 'DEL', 80],
  ]),
  // ---- cuartofinalistas 1954 ----
  squad('ger1954', 'Alemania', 1954, '🇩🇪', 'El Milagro de Berna', '#FFFFFF', '#111111', [
    ['Turek', 'POR', 84],
    ['Posipal', 'DEF', 76], ['Kohlmeyer', 'DEF', 76], ['Liebrich', 'DEF', 80], ['Laband', 'DEF', 68],
    ['Eckel', 'MED', 78], ['Mai', 'MED', 74], ['Morlock', 'MED', 84],
    ['Rahn', 'DEL', 88], ['F. Walter', 'DEL', 92], ['O. Walter', 'DEL', 80], ['Schäfer', 'DEL', 82],
  ]),
  squad('uru1954', 'Uruguay', 1954, '🇺🇾', 'Los Celestes del 54', '#5CB8E4', '#1B1A17', [
    ['Máspoli', 'POR', 84],
    ['Santamaría', 'DEF', 86], ['Andrade', 'DEF', 82], ['W. Martínez', 'DEF', 72], ['Cruz', 'DEF', 66],
    ['Ambrois', 'MED', 78], ['Davoine', 'MED', 64],
    ['Schiaffino', 'DEL', 93], ['Borges', 'MED', 82], ['Hohberg', 'DEL', 80],
    ['Abbadie', 'DEL', 80], ['Míguez', 'DEL', 80],
  ]),
  squad('aut1954', 'Austria', 1954, '🇦🇹', 'El Wunderteam Tardío', '#FFFFFF', '#ED2939', [
    ['Zeman', 'POR', 76],
    ['Happel', 'DEF', 84], ['Hanappi', 'DEF', 84], ['Barschandt', 'DEF', 68], ['Schleger', 'DEF', 66],
    ['Ocwirk', 'MED', 88], ['Koller', 'MED', 70], ['Wagner', 'MED', 78],
    ['Probst', 'DEL', 84], ['Stojaspal', 'DEL', 80], ['A. Körner', 'DEL', 78],
    ['R. Körner', 'DEL', 76], ['Dienst', 'DEL', 74],
  ]),
  squad('sui1954', 'Suiza', 1954, '🇨🇭', 'Los Anfitriones del 54', '#D52B1E', '#FFFFFF', [
    ['Parlier', 'POR', 74],
    ['Bocquet', 'DEF', 72], ['Kernen', 'DEF', 74], ['Neury', 'DEF', 66], ['Fluckiger', 'DEF', 62],
    ['Eggimann', 'MED', 70], ['Casali', 'MED', 64],
    ['Ballaman', 'DEL', 80], ['Hügi', 'DEL', 82], ['Fatton', 'DEL', 78],
    ['Antenen', 'MED', 76], ['Vonlanthen', 'DEL', 74],
  ]),
  squad('eng1954', 'Inglaterra', 1954, '🏴', 'Los de Matthews', '#FFFFFF', '#1B3D8F', [
    ['Merrick', 'POR', 76],
    ['W. Wright', 'DEF', 84], ['Byrne', 'DEF', 76], ['Staniforth', 'DEF', 68], ['Owen', 'DEF', 64],
    ['Dickinson', 'MED', 76], ['Broadis', 'MED', 74], ['Quixall', 'MED', 68],
    ['Matthews', 'DEL', 92], ['Finney', 'DEL', 88], ['Lofthouse', 'DEL', 86],
    ['T. Taylor', 'DEL', 80], ['Wilshaw', 'DEL', 74],
  ]),
  squad('yug1954', 'Yugoslavia', 1954, '🏳️', 'Los Plavi del 54', '#1B3D8F', '#FFFFFF', [
    ['Beara', 'POR', 84],
    ['Stanković', 'DEF', 72], ['Crnković', 'DEF', 70], ['Horvat', 'DEF', 74],
    ['Boškov', 'MED', 80], ['Čajkovski', 'MED', 78],
    ['Vukas', 'MED', 86], ['Mitić', 'DEL', 84], ['Zebec', 'DEF', 82],
    ['Bobek', 'DEL', 84], ['Milutinović', 'DEL', 74],
  ]),
  squad('bra1954', 'Brasil', 1954, '🇧🇷', 'Los de Suiza 54', '#FFD700', '#1B7A3D', [
    ['Castilho', 'POR', 76],
    ['Djalma Santos', 'DEF', 84], ['Nilton Santos', 'DEF', 86], ['Pinheiro', 'DEF', 72], ['Paulinho', 'DEF', 66],
    ['Bauer', 'MED', 78], ['Didi', 'MED', 88], ['Brandãozinho', 'MED', 70],
    ['Julinho', 'DEL', 88], ['Baltazar', 'DEL', 76], ['Pinga', 'DEL', 74], ['Maurinho', 'DEL', 70],
  ]),
  // ---- cuartofinalistas 1958 ----
  squad('fra1958', 'Francia', 1958, '🇫🇷', 'Los 13 Goles de Fontaine', '#1B3D8F', '#FFFFFF', [
    ['Abbes', 'POR', 74],
    ['Jonquet', 'DEF', 80], ['Marche', 'DEF', 74], ['Kaelbel', 'DEF', 70], ['Lerond', 'DEF', 68],
    ['Penverne', 'MED', 74], ['Marcel', 'MED', 70],
    ['Kopa', 'DEL', 92], ['Fontaine', 'DEL', 94], ['Piantoni', 'MED', 86],
    ['Vincent', 'DEL', 78], ['Wisnieski', 'DEL', 74],
  ]),
  squad('swe1958', 'Suecia', 1958, '🇸🇪', 'Los Subcampeones del 58', '#FFCC00', '#0050A0', [
    ['Svensson', 'POR', 80],
    ['Bergmark', 'DEF', 80], ['Gustavsson', 'DEF', 76], ['Axbom', 'DEF', 70],
    ['Liedholm', 'MED', 90], ['Gren', 'MED', 86], ['Parling', 'DEF', 70], ['Börjesson', 'MED', 64],
    ['Hamrin', 'DEL', 90], ['Simonsson', 'DEL', 82], ['Skoglund', 'DEL', 84], ['Berndtsson', 'DEL', 68],
  ]),
  squad('ger1958', 'Alemania', 1958, '🇩🇪', 'Los del 58', '#FFFFFF', '#111111', [
    ['Herkenrath', 'POR', 76],
    ['Juskowiak', 'DEF', 72], ['Erhardt', 'DEF', 74], ['Stollenwerk', 'DEF', 68],
    ['Eckel', 'DEF', 76], ['Szymaniak', 'MED', 78],
    ['Rahn', 'DEL', 88], ['Seeler', 'DEL', 84], ['F. Walter', 'MED', 86],
    ['Schäfer', 'MED', 80], ['Klodt', 'DEL', 70],
  ]),
  squad('urs1958', 'Unión Soviética', 1958, '🏳️', 'La Cortina de Yashin', '#CC0000', '#FFFFFF', [
    ['Yashin', 'POR', 94],
    ['Kesarev', 'DEF', 70], ['Krizhevsky', 'DEF', 70], ['B. Kuznetsov', 'DEF', 68],
    ['Netto', 'MED', 84], ['Voinov', 'DEF', 76],
    ['Simonyan', 'DEL', 84], ['V. Ivanov', 'DEL', 84], ['Ilyin', 'MED', 78],
    ['Salnikov', 'MED', 76], ['Apukhtin', 'DEL', 64],
  ]),
  squad('nir1958', 'Irlanda del Norte', 1958, '🏳️', 'Los de Blanchflower', '#00843D', '#FFFFFF', [
    ['Gregg', 'POR', 82],
    ['Keith', 'DEF', 70], ['McMichael', 'DEF', 70], ['Cunningham', 'DEF', 68],
    ['Blanchflower', 'MED', 88], ['Cush', 'DEF', 74], ['Peacock', 'MED', 72],
    ['McParland', 'DEL', 84], ['Bingham', 'DEL', 78], ['McIlroy', 'MED', 78],
    ['Dougan', 'DEL', 70], ['Casey', 'DEL', 64],
  ]),
  squad('wal1958', 'Gales', 1958, '🏴', 'Los Dragones del 58', '#D30731', '#FFFFFF', [
    ['Kelsey', 'POR', 82],
    ['S. Williams', 'DEF', 70], ['Hopkins', 'DEF', 70], ['M. Charles', 'DEF', 76],
    ['Sullivan', 'DEF', 68], ['Bowen', 'MED', 72],
    ['J. Charles', 'DEL', 92], ['I. Allchurch', 'MED', 86], ['C. Jones', 'DEL', 82],
    ['Medwin', 'MED', 74], ['Webster', 'DEL', 70],
  ]),
  squad('yug1958', 'Yugoslavia', 1958, '🏳️', 'Los Plavi del 58', '#1B3D8F', '#FFFFFF', [
    ['Beara', 'POR', 82],
    ['Crnković', 'DEF', 70], ['Šijaković', 'DEF', 64], ['Zebec', 'DEF', 78],
    ['Boškov', 'MED', 78], ['Krstić', 'DEF', 70],
    ['Šekularac', 'DEL', 86], ['Veselinović', 'MED', 78], ['Petaković', 'DEL', 74],
    ['Milutinović', 'DEL', 74], ['Rajkov', 'MED', 64],
  ]),
  // ---- cuartofinalistas 1962 ----
  squad('bra1962', 'Brasil', 1962, '🇧🇷', 'El Bicampeón', '#FFD700', '#1B7A3D', [
    ['Gilmar', 'POR', 84],
    ['Djalma Santos', 'DEF', 86], ['Mauro', 'DEF', 78], ['Nilton Santos', 'DEF', 86], ['Zózimo', 'DEF', 74],
    ['Zito', 'MED', 82], ['Didi', 'MED', 88],
    ['Garrincha', 'DEL', 96], ['Vavá', 'DEL', 86], ['Pelé', 'DEL', 95],
    ['Amarildo', 'DEL', 84], ['Zagallo', 'MED', 82],
  ]),
  squad('urs1962', 'Unión Soviética', 1962, '🏳️', 'Los de Chile 62', '#CC0000', '#FFFFFF', [
    ['Yashin', 'POR', 92],
    ['Chokheli', 'DEF', 66], ['Maslyonkin', 'DEF', 68], ['Ostrovski', 'DEF', 66],
    ['Netto', 'DEF', 82], ['Voronin', 'MED', 84],
    ['Chislenko', 'DEL', 84], ['V. Ivanov', 'DEL', 86], ['Ponedelnik', 'DEL', 84],
    ['Meskhi', 'MED', 82], ['Metreveli', 'MED', 80],
  ]),
  squad('yug1962', 'Yugoslavia', 1962, '🏳️', 'Los Plavi de Chile', '#1B3D8F', '#FFFFFF', [
    ['Šoškić', 'POR', 80],
    ['Durković', 'DEF', 68], ['Jusufi', 'DEF', 70], ['Marković', 'DEF', 72], ['Radaković', 'DEF', 74],
    ['Šekularac', 'MED', 86], ['Perušić', 'MED', 66],
    ['Galić', 'DEL', 84], ['Jerković', 'DEL', 84], ['Skoblar', 'MED', 80], ['Mujić', 'DEL', 66],
  ]),
  squad('tch1962', 'Checoslovaquia', 1962, '🏳️', 'Los de Masopust', '#D7141A', '#FFFFFF', [
    ['Schrojf', 'POR', 84],
    ['Popluhár', 'DEF', 80], ['Novák', 'DEF', 76], ['Pluskal', 'DEF', 78], ['Lála', 'DEF', 70],
    ['Masopust', 'MED', 92], ['Kvašňák', 'MED', 80],
    ['Pospíchal', 'MED', 76], ['Scherer', 'DEL', 78], ['Jelínek', 'DEL', 76], ['Kadraba', 'DEL', 72],
  ]),
  squad('hun1962', 'Hungría', 1962, '🇭🇺', 'Los Magiares del 62', '#CE2939', '#FFFFFF', [
    ['Grosics', 'POR', 82],
    ['Mátrai', 'DEF', 74], ['Solymosi', 'DEF', 76], ['Mészöly', 'DEF', 78], ['Sárosi', 'DEF', 66],
    ['Sipos', 'MED', 76], ['Rákosi', 'MED', 72],
    ['Albert', 'DEL', 88], ['Tichy', 'DEL', 84], ['Göröcs', 'MED', 78],
    ['Sándor', 'DEL', 80], ['Fenyvesi', 'DEL', 76],
  ]),
  squad('eng1962', 'Inglaterra', 1962, '🏴', 'Los de Chile 62', '#FFFFFF', '#1B3D8F', [
    ['Springett', 'POR', 76],
    ['Armfield', 'DEF', 78], ['Wilson', 'DEF', 76], ['Norman', 'DEF', 70], ['Flowers', 'DEF', 74],
    ['Moore', 'MED', 84], ['Haynes', 'MED', 84],
    ['Greaves', 'DEL', 88], ['B. Charlton', 'DEL', 88], ['Hitchens', 'DEL', 74], ['Douglas', 'MED', 76],
  ]),
  squad('ger1962', 'Alemania', 1962, '🇩🇪', 'Los del 62', '#FFFFFF', '#111111', [
    ['Fahrian', 'POR', 72],
    ['Schnellinger', 'DEF', 84], ['Erhardt', 'DEF', 74], ['Nowak', 'DEF', 66], ['Giesemann', 'DEF', 66],
    ['Szymaniak', 'MED', 78], ['Schulz', 'MED', 72], ['Haller', 'MED', 80],
    ['Seeler', 'DEL', 88], ['Brülls', 'DEL', 72], ['Strehl', 'DEL', 64],
  ]),
  // ---- cuartofinalistas 1966 ----
  squad('ger1966', 'Alemania', 1966, '🇩🇪', 'Los de Wembley 66', '#FFFFFF', '#111111', [
    ['Tilkowski', 'POR', 80],
    ['Höttges', 'DEF', 74], ['Schnellinger', 'DEF', 86], ['Weber', 'DEF', 78], ['Schulz', 'DEF', 74],
    ['Beckenbauer', 'MED', 90], ['Overath', 'MED', 84], ['Haller', 'MED', 84],
    ['Seeler', 'DEL', 88], ['Held', 'DEL', 80], ['Emmerich', 'DEL', 76],
  ]),
  squad('urs1966', 'Unión Soviética', 1966, '🏳️', 'Los Semifinalistas del 66', '#CC0000', '#FFFFFF', [
    ['Yashin', 'POR', 88],
    ['Shesternyov', 'DEF', 84], ['Ponomarev', 'DEF', 70], ['Danilov', 'DEF', 66],
    ['Khurtsilava', 'DEF', 74],
    ['Voronin', 'MED', 84], ['Sabo', 'MED', 76], ['Metreveli', 'MED', 76],
    ['Chislenko', 'DEL', 86], ['Banishevsky', 'DEL', 78], ['Malofeyev', 'DEL', 78],
    ['Porkujan', 'DEL', 76],
  ]),
  squad('hun1966', 'Hungría', 1966, '🇭🇺', 'Los de Albert', '#CE2939', '#FFFFFF', [
    ['Gelei', 'POR', 72],
    ['Mátrai', 'DEF', 72], ['Mészöly', 'DEF', 80], ['Kaposzta', 'DEF', 66], ['Sóvári', 'DEF', 64],
    ['Sipos', 'MED', 74], ['Rákosi', 'MED', 74],
    ['Albert', 'DEL', 90], ['Bene', 'DEL', 86], ['Farkas', 'DEL', 82], ['Mathesz', 'MED', 64],
  ]),
  squad('prk1966', 'Corea del Norte', 1966, '🇰🇵', 'La Sorpresa de Middlesbrough', '#ED1C27', '#FFFFFF', [
    ['Ri Chan-myong', 'POR', 72],
    ['Shin Yung-kyoo', 'DEF', 68], ['Rim Zoong-sun', 'DEF', 64], ['Kang Bong-chil', 'DEF', 64],
    ['O Yoon-kyung', 'DEF', 62],
    ['Pak Seung-zin', 'MED', 78], ['Im Seung-hwi', 'MED', 70],
    ['Pak Doo-ik', 'DEL', 78], ['Han Bong-zin', 'MED', 74], ['Yang Sung-kook', 'DEL', 72],
    ['Kim Seung-il', 'DEL', 64],
  ]),
  squad('uru1966', 'Uruguay', 1966, '🇺🇾', 'Los Celestes del 66', '#5CB8E4', '#1B1A17', [
    ['Mazurkiewicz', 'POR', 84],
    ['Troche', 'DEF', 76], ['Manicera', 'DEF', 74], ['Goncálvez', 'DEF', 74], ['Ubiña', 'DEF', 74],
    ['Rocha', 'MED', 86], ['Cortés', 'MED', 78], ['Caetano', 'MED', 66],
    ['Urruzmendi', 'DEL', 68], ['Viera', 'DEL', 66], ['Silva', 'DEL', 64],
  ]),
  squad('arg1966', 'Argentina', 1966, '🇦🇷', 'Los de Rattín', '#75AADB', '#FFFFFF', [
    ['Roma', 'POR', 76],
    ['Perfumo', 'DEF', 82], ['Marzolini', 'DEF', 82], ['Albrecht', 'DEF', 72], ['Ferreiro', 'DEF', 68],
    ['Rattín', 'MED', 86], ['González', 'MED', 68], ['Solari', 'MED', 72],
    ['Onega', 'DEL', 80], ['Más', 'DEL', 78], ['Artime', 'DEL', 80],
  ]),
  // ---- cuartofinalistas 1970 ----
  squad('ger1970', 'Alemania', 1970, '🇩🇪', 'Los del Partido del Siglo', '#FFFFFF', '#111111', [
    ['Maier', 'POR', 90],
    ['Vogts', 'DEF', 84], ['Schnellinger', 'DEF', 84], ['Schulz', 'DEF', 72], ['Höttges', 'DEF', 72],
    ['Beckenbauer', 'MED', 94], ['Overath', 'MED', 86], ['Fichtel', 'MED', 70],
    ['Seeler', 'DEL', 86], ['G. Müller', 'DEL', 94], ['Grabowski', 'DEL', 78],
    ['Libuda', 'DEL', 76], ['Löhr', 'DEL', 72],
  ]),
  squad('uru1970', 'Uruguay', 1970, '🇺🇾', 'Los Semifinalistas del 70', '#5CB8E4', '#1B1A17', [
    ['Mazurkiewicz', 'POR', 86],
    ['Ubiña', 'DEF', 76], ['Ancheta', 'DEF', 78], ['Matosas', 'DEF', 74], ['Mujica', 'DEF', 72],
    ['Montero Castillo', 'MED', 76], ['Maneiro', 'MED', 78], ['Cortés', 'MED', 76],
    ['Rocha', 'DEL', 84], ['Cubilla', 'DEL', 80], ['Espárrago', 'DEL', 74], ['Fontes', 'DEL', 68],
  ]),
  squad('mex1970', 'México', 1970, '🇲🇽', 'Los Anfitriones del 70', '#006847', '#FFFFFF', [
    ['Calderón', 'POR', 76],
    ['Vantolrá', 'DEF', 70], ['Peña', 'DEF', 76], ['Guzmán', 'DEF', 74], ['Pérez', 'DEF', 66],
    ['Pulido', 'MED', 72], ['Munguía', 'MED', 70], ['González', 'MED', 66],
    ['Fragoso', 'DEL', 78], ['Valdivia', 'DEL', 74], ['Padilla', 'DEL', 72],
    ['Basaguren', 'DEL', 66], ['Borja', 'DEL', 70],
  ]),
  squad('urs1970', 'Unión Soviética', 1970, '🏳️', 'Los de México 70', '#CC0000', '#FFFFFF', [
    ['Kavazashvili', 'POR', 78],
    ['Shesternyov', 'DEF', 82], ['Afonin', 'DEF', 70], ['Khurtsilava', 'DEF', 74],
    ['Dzodzuashvili', 'DEF', 70],
    ['Muntyan', 'MED', 78], ['Asatiani', 'MED', 74], ['Logofet', 'MED', 66],
    ['Byshovets', 'DEL', 82], ['Khmelnitsky', 'DEL', 76], ['Yevryuzhikhin', 'DEL', 70],
  ]),
  squad('per1970', 'Perú', 1970, '🇵🇪', 'Los de Didí', '#FFFFFF', '#D91023', [
    ['Rubiños', 'POR', 72],
    ['Chumpitaz', 'DEF', 86], ['E. Campos', 'DEF', 68], ['De la Torre', 'DEF', 70], ['Fernández', 'DEF', 64],
    ['Mifflin', 'MED', 78], ['Challe', 'MED', 76],
    ['Cubillas', 'DEL', 90], ['Sotil', 'DEL', 80], ['Gallardo', 'DEL', 78],
    ['Baylón', 'MED', 74], ['León', 'DEL', 70],
  ]),
  squad('eng1970', 'Inglaterra', 1970, '🏴', 'Los Campeones Defensores', '#FFFFFF', '#1B3D8F', [
    ['Banks', 'POR', 92], ['Bonetti', 'POR', 76],
    ['Cooper', 'DEF', 76], ['Moore', 'DEF', 94], ['Labone', 'DEF', 74], ['Newton', 'DEF', 70],
    ['Mullery', 'MED', 78], ['B. Charlton', 'MED', 90], ['Ball', 'MED', 84], ['Peters', 'MED', 82],
    ['Hurst', 'DEL', 84], ['Lee', 'DEL', 78], ['Astle', 'DEL', 72],
  ]),
  // ---- cuartofinalistas 1974 ----
  squad('bra1974', 'Brasil', 1974, '🇧🇷', 'Los del 74', '#FFD700', '#1B7A3D', [
    ['Leão', 'POR', 84],
    ['Zé Maria', 'DEF', 74], ['Luís Pereira', 'DEF', 82], ['Marinho Peres', 'DEF', 74],
    ['Marinho Chagas', 'DEF', 78],
    ['Rivellino', 'MED', 90], ['Paulo César Carpegiani', 'MED', 74], ['Dirceu', 'MED', 78],
    ['Jairzinho', 'DEL', 88], ['Valdomiro', 'DEL', 72], ['Mirandinha', 'DEL', 66],
  ]),
  squad('swe1974', 'Suecia', 1974, '🇸🇪', 'Los Vikingos del 74', '#FFCC00', '#0050A0', [
    ['Hellström', 'POR', 84],
    ['Olsson', 'DEF', 70], ['Karlsson', 'DEF', 72], ['Augustsson', 'DEF', 70], ['Andersson J.', 'DEF', 64],
    ['Grahn', 'MED', 78], ['Tapper', 'MED', 72], ['Bo Larsson', 'MED', 80],
    ['Edström', 'DEL', 82], ['Sandberg', 'DEL', 78], ['Torstensson', 'DEL', 74],
  ]),
  squad('arg1974', 'Argentina', 1974, '🇦🇷', 'Los del 74', '#75AADB', '#FFFFFF', [
    ['Carnevali', 'POR', 76],
    ['Perfumo', 'DEF', 80], ['Heredia', 'DEF', 74], ['Sá', 'DEF', 72], ['Wolff', 'DEF', 72],
    ['Babington', 'MED', 80], ['Brindisi', 'MED', 78], ['Telch', 'MED', 70],
    ['Kempes', 'DEL', 82], ['Rubén Ayala', 'DEL', 78], ['Houseman', 'DEL', 78],
    ['Yazalde', 'DEL', 76], ['Balbuena', 'DEL', 68],
  ]),
  squad('gdr1974', 'Alemania Oriental', 1974, '🏳️', 'El Gol de Sparwasser', '#FFFFFF', '#003DA5', [
    ['Croy', 'POR', 80],
    ['Bransch', 'DEF', 76], ['Weise', 'DEF', 74], ['Watzlich', 'DEF', 66], ['Kurbjuweit', 'DEF', 68],
    ['Irmscher', 'MED', 70], ['Lauck', 'MED', 70], ['Pommerenke', 'MED', 72],
    ['Sparwasser', 'DEL', 78], ['Streich', 'DEL', 78], ['Kreische', 'DEL', 74], ['Hoffmann', 'DEL', 68],
  ]),
  squad('yug1974', 'Yugoslavia', 1974, '🏳️', 'Los Plavi del 74', '#1B3D8F', '#FFFFFF', [
    ['Marić', 'POR', 74],
    ['Buljan', 'DEF', 76], ['Katalinski', 'DEF', 76], ['Hadžiabdić', 'DEF', 70], ['Bogićević', 'DEF', 74],
    ['Oblak', 'MED', 78], ['Aćimović', 'MED', 78],
    ['Džajić', 'DEL', 88], ['Šurjak', 'DEL', 80], ['Karasi', 'MED', 74], ['Bajević', 'DEL', 78],
  ]),
  // ---- top 8 de 1978 ----
  squad('ned1978', 'Holanda', 1978, '🇳🇱', 'La Naranja del 78', '#F36C21', '#FFFFFF', [
    ['Jongbloed', 'POR', 72], ['Schrijvers', 'POR', 70],
    ['Krol', 'DEF', 88], ['Brandts', 'DEF', 74], ['Poortvliet', 'DEF', 72], ['Wildschut', 'DEF', 68],
    ['Haan', 'MED', 84], ['Jansen', 'MED', 80], ['Neeskens', 'MED', 88],
    ['W. van de Kerkhof', 'MED', 78],
    ['Rensenbrink', 'DEL', 88], ['Rep', 'DEL', 84], ['R. van de Kerkhof', 'DEL', 80],
  ]),
  squad('bra1978', 'Brasil', 1978, '🇧🇷', 'Los Invictos del 78', '#FFD700', '#1B7A3D', [
    ['Leão', 'POR', 86],
    ['Nelinho', 'DEF', 78], ['Oscar', 'DEF', 80], ['Amaral', 'DEF', 76], ['Edinho', 'DEF', 74],
    ['Cerezo', 'MED', 82], ['Batista', 'MED', 74], ['Zico', 'MED', 88], ['Rivellino', 'MED', 84],
    ['Dirceu', 'MED', 82],
    ['Roberto Dinamite', 'DEL', 80], ['Reinaldo', 'DEL', 80], ['Gil', 'DEL', 70],
  ]),
  squad('ita1978', 'Italia', 1978, '🇮🇹', 'Los del 78', '#1A60A8', '#FFFFFF', [
    ['Zoff', 'POR', 90],
    ['Gentile', 'DEF', 84], ['Scirea', 'DEF', 88], ['Cabrini', 'DEF', 82], ['Cuccureddu', 'DEF', 72],
    ['Tardelli', 'MED', 84], ['Benetti', 'MED', 76], ['Antognoni', 'MED', 84],
    ['Causio', 'DEL', 80], ['Rossi', 'DEL', 86], ['Bettega', 'DEL', 86], ['Graziani', 'DEL', 78],
  ]),
  squad('pol1978', 'Polonia', 1978, '🇵🇱', 'Las Águilas del 78', '#FFFFFF', '#DC143C', [
    ['Tomaszewski', 'POR', 80],
    ['Szymanowski', 'DEF', 76], ['Gorgoń', 'DEF', 78], ['Żmuda', 'DEF', 80], ['Maculewicz', 'DEF', 66],
    ['Deyna', 'MED', 86], ['Nawałka', 'MED', 72], ['Masztaler', 'MED', 68], ['Boniek', 'MED', 84],
    ['Lato', 'DEL', 84], ['Szarmach', 'DEL', 80], ['Lubański', 'DEL', 78],
  ]),
  squad('ger1978', 'Alemania', 1978, '🇩🇪', 'Los del 78', '#FFFFFF', '#111111', [
    ['Maier', 'POR', 88],
    ['Vogts', 'DEF', 84], ['Kaltz', 'DEF', 80], ['Rüssmann', 'DEF', 74], ['Dietz', 'DEF', 72],
    ['Bonhof', 'MED', 84], ['Flohe', 'MED', 76], ['H. Müller', 'MED', 76], ['Beer', 'MED', 70],
    ['Rummenigge', 'DEL', 84], ['Fischer', 'DEL', 82], ['Abramczik', 'DEL', 74],
    ['Hölzenbein', 'DEL', 76],
  ]),
  squad('aut1978', 'Austria', 1978, '🇦🇹', 'El Córdobazo', '#FFFFFF', '#ED2939', [
    ['Koncilia', 'POR', 80],
    ['Sara', 'DEF', 70], ['Obermayer', 'DEF', 74], ['Pezzey', 'DEF', 82], ['Breitenberger', 'DEF', 66],
    ['Prohaska', 'MED', 84], ['Hickersberger', 'MED', 72], ['Kreuz', 'MED', 74],
    ['Krankl', 'DEL', 86], ['Jara', 'DEL', 78], ['Schachner', 'DEL', 74], ['Oberacher', 'DEL', 66],
  ]),
  squad('per1978', 'Perú', 1978, '🇵🇪', 'Los del Cholo Sotil', '#FFFFFF', '#D91023', [
    ['Quiroga', 'POR', 78],
    ['Chumpitaz', 'DEF', 84], ['Manzo', 'DEF', 72], ['Olaechea', 'DEF', 68], ['Navarro J.', 'DEF', 64],
    ['Velásquez', 'MED', 78], ['Cueto', 'MED', 82], ['Quesada', 'MED', 68],
    ['Cubillas', 'DEL', 88], ['Oblitas', 'DEL', 82], ['Muñante', 'DEL', 78],
    ['Sotil', 'DEL', 76], ['La Rosa', 'DEL', 72],
  ]),
  // ---- segunda fase de 1982 ----
  squad('ger1982', 'Alemania', 1982, '🇩🇪', 'Los de España 82', '#FFFFFF', '#111111', [
    ['Schumacher', 'POR', 86],
    ['Kaltz', 'DEF', 80], ['K. Förster', 'DEF', 80], ['Briegel', 'DEF', 82], ['Stielike', 'DEF', 80],
    ['Breitner', 'MED', 86], ['Dremmler', 'MED', 72], ['H. Müller', 'MED', 76], ['Magath', 'MED', 78],
    ['Rummenigge', 'DEL', 90], ['Fischer', 'DEL', 80], ['Hrubesch', 'DEL', 78], ['Littbarski', 'DEL', 80],
  ]),
  squad('pol1982', 'Polonia', 1982, '🇵🇱', 'Las Águilas de Boniek', '#FFFFFF', '#DC143C', [
    ['Młynarczyk', 'POR', 78],
    ['Żmuda', 'DEF', 78], ['Janas', 'DEF', 76], ['Majewski', 'DEF', 72], ['Dziuba', 'DEF', 66],
    ['Boniek', 'MED', 90], ['Buncol', 'MED', 74], ['Matysik', 'MED', 72], ['Kupcewicz', 'MED', 72],
    ['Lato', 'DEL', 80], ['Smolarek', 'DEL', 76], ['Szarmach', 'DEL', 76],
  ]),
  squad('fra1982', 'Francia', 1982, '🇫🇷', 'La Tragedia de Sevilla', '#1B3D8F', '#FFFFFF', [
    ['Ettori', 'POR', 76],
    ['Amoros', 'DEF', 82], ['Trésor', 'DEF', 84], ['Janvion', 'DEF', 72], ['Bossis', 'DEF', 80],
    ['Battiston', 'DEF', 78],
    ['Platini', 'MED', 94], ['Giresse', 'MED', 88], ['Tigana', 'MED', 86], ['Genghini', 'MED', 76],
    ['Rocheteau', 'DEL', 82], ['Six', 'DEL', 76], ['Soler', 'DEL', 74], ['Lacombe', 'DEL', 74],
  ]),
  squad('eng1982', 'Inglaterra', 1982, '🏴', 'Los Invictos del 82', '#FFFFFF', '#1B3D8F', [
    ['Shilton', 'POR', 86],
    ['Mills', 'DEF', 72], ['Thompson', 'DEF', 76], ['Butcher', 'DEF', 78], ['Sansom', 'DEF', 76],
    ['Robson', 'MED', 86], ['Wilkins', 'MED', 80], ['Coppell', 'MED', 76], ['Brooking', 'MED', 80],
    ['Keegan', 'DEL', 86], ['Francis', 'DEL', 80], ['Mariner', 'DEL', 76], ['Woodcock', 'DEL', 76],
  ]),
  squad('urs1982', 'Unión Soviética', 1982, '🏳️', 'Los de Dasayev', '#CC0000', '#FFFFFF', [
    ['Dasayev', 'POR', 88],
    ['Chivadze', 'DEF', 80], ['Demianenko', 'DEF', 78], ['Baltacha', 'DEF', 74], ['Borovsky', 'DEF', 70],
    ['Bessonov', 'MED', 78], ['Gavrilov', 'MED', 78], ['Bal', 'MED', 72], ['Oganesian', 'MED', 74],
    ['Blokhin', 'DEL', 88], ['Shengelia', 'DEL', 80], ['Andreyev', 'DEL', 68],
  ]),
  squad('aut1982', 'Austria', 1982, '🇦🇹', 'Los del 82', '#FFFFFF', '#ED2939', [
    ['Koncilia', 'POR', 78],
    ['Obermayer', 'DEF', 72], ['Pezzey', 'DEF', 80], ['Krauss', 'DEF', 68], ['Degeorgi', 'DEF', 64],
    ['Prohaska', 'MED', 82], ['Hintermaier', 'MED', 70], ['Hattenberger', 'MED', 68],
    ['Krankl', 'DEL', 80], ['Schachner', 'DEL', 78], ['Welzl', 'DEL', 66], ['Jurtin', 'DEL', 62],
  ]),
  // ---- cuartofinalistas 1986 ----
  squad('ger1986', 'Alemania', 1986, '🇩🇪', 'Los Subcampeones del 86', '#FFFFFF', '#111111', [
    ['Schumacher', 'POR', 84],
    ['Berthold', 'DEF', 78], ['K. Förster', 'DEF', 78], ['Jakobs', 'DEF', 72], ['Briegel', 'DEF', 78],
    ['Brehme', 'DEF', 84],
    ['Matthäus', 'MED', 88], ['Magath', 'MED', 76], ['Eder', 'MED', 70],
    ['Rummenigge', 'DEL', 84], ['Völler', 'DEL', 84], ['Allofs', 'DEL', 78], ['Littbarski', 'DEL', 78],
  ]),
  squad('eng1986', 'Inglaterra', 1986, '🏴', 'Las Víctimas de la Mano de Dios', '#FFFFFF', '#1B3D8F', [
    ['Shilton', 'POR', 86],
    ['Stevens', 'DEF', 72], ['Sansom', 'DEF', 76], ['Butcher', 'DEF', 80], ['Fenwick', 'DEF', 72],
    ['Robson', 'MED', 84], ['Wilkins', 'MED', 78], ['Hoddle', 'MED', 84], ['Hodge', 'MED', 74],
    ['Steven', 'MED', 74],
    ['Lineker', 'DEL', 90], ['Beardsley', 'DEL', 82], ['Waddle', 'DEL', 80], ['Hateley', 'DEL', 74],
  ]),
  squad('bra1986', 'Brasil', 1986, '🇧🇷', 'Los de México 86', '#FFD700', '#1B7A3D', [
    ['Carlos', 'POR', 78],
    ['Josimar', 'DEF', 78], ['Júlio César S.', 'DEF', 74], ['Edinho', 'DEF', 76], ['Branco', 'DEF', 78],
    ['Elzo', 'MED', 72], ['Alemão', 'MED', 80], ['Sócrates', 'MED', 88], ['Zico', 'MED', 88],
    ['Falcão', 'MED', 82], ['Júnior', 'MED', 82],
    ['Careca', 'DEL', 88], ['Müller', 'DEL', 80], ['Casagrande', 'DEL', 74],
  ]),
  squad('mex1986', 'México', 1986, '🇲🇽', 'Los de Hugo Sánchez', '#006847', '#FFFFFF', [
    ['Larios', 'POR', 76],
    ['Quirarte', 'DEF', 76], ['Amador', 'DEF', 70], ['Servín', 'DEF', 72], ['Félix Cruz', 'DEF', 68],
    ['Boy', 'MED', 76], ['Negrete', 'MED', 82], ['Aguirre', 'MED', 76], ['Muñoz', 'MED', 70],
    ['Hugo Sánchez', 'DEL', 90], ['Flores', 'DEL', 74], ['Sánchez F.', 'DEL', 66],
  ]),
  squad('bel1986', 'Bélgica', 1986, '🇧🇪', 'Los Diablos del 86', '#ED2939', '#1B1A17', [
    ['Pfaff', 'POR', 86],
    ['Gerets', 'DEF', 80], ['Grün', 'DEF', 72], ['Renquin', 'DEF', 70], ['Demol', 'DEF', 74],
    ['Vervoort', 'MED', 74], ['Scifo', 'MED', 84], ['Vercauteren', 'MED', 78], ['Mommens', 'MED', 70],
    ['Ceulemans', 'DEL', 86], ['Claesen', 'DEL', 78], ['Veyt', 'DEL', 70], ['Desmet', 'DEL', 68],
  ]),
  squad('esp1986', 'España', 1986, '🇪🇸', 'Los del Buitre', '#C8102E', '#FFC400', [
    ['Zubizarreta', 'POR', 84],
    ['Camacho', 'DEF', 80], ['Gordillo', 'DEF', 78], ['Maceda', 'DEF', 76], ['A. Goikoetxea', 'DEF', 74],
    ['Tomás', 'DEF', 70],
    ['Míchel', 'MED', 82], ['Víctor', 'MED', 76], ['Calderé', 'MED', 74], ['Francisco', 'MED', 70],
    ['Butragueño', 'DEL', 88], ['Salinas', 'DEL', 78], ['Eloy', 'DEL', 72], ['Julio Alberto', 'DEL', 74],
  ]),
  // ---- cuartofinalistas 1990 ----
  squad('arg1990', 'Argentina', 1990, '🇦🇷', 'Los de Goycochea', '#75AADB', '#FFFFFF', [
    ['Goycochea', 'POR', 86], ['Pumpido', 'POR', 76],
    ['Simón', 'DEF', 76], ['Ruggeri', 'DEF', 86], ['Serrizuela', 'DEF', 72], ['Sensini', 'DEF', 76],
    ['Olarticoechea', 'DEF', 76],
    ['Batista', 'MED', 76], ['Giusti', 'MED', 76], ['Basualdo', 'MED', 72], ['Burruchaga', 'MED', 82],
    ['Maradona', 'MED', 92],
    ['Caniggia', 'DEL', 86], ['Troglio', 'DEL', 72], ['Dezotti', 'DEL', 70], ['Calderón', 'DEL', 72],
  ]),
  squad('ita1990', 'Italia', 1990, '🇮🇹', 'Las Noches Mágicas', '#1A60A8', '#FFFFFF', [
    ['Zenga', 'POR', 88],
    ['Bergomi', 'DEF', 84], ['Baresi', 'DEF', 92], ['Maldini', 'DEF', 88], ['Ferri', 'DEF', 78],
    ['Ferrara', 'DEF', 78],
    ['De Napoli', 'MED', 76], ['Giannini', 'MED', 82], ['Ancelotti', 'MED', 80], ['Donadoni', 'MED', 82],
    ['Schillaci', 'DEL', 88], ['R. Baggio', 'DEL', 88], ['Vialli', 'DEL', 84],
    ['Serena', 'DEL', 76], ['Carnevale', 'DEL', 74],
  ]),
  squad('irl1990', 'Irlanda', 1990, '🇮🇪', 'El Ejército Verde', '#169B62', '#FFFFFF', [
    ['Bonner', 'POR', 78],
    ['Morris', 'DEF', 70], ['McCarthy', 'DEF', 74], ['Moran', 'DEF', 74], ['Staunton', 'DEF', 76],
    ['McGrath', 'MED', 84], ['Houghton', 'MED', 78], ['Townsend', 'MED', 76], ['Sheedy', 'MED', 76],
    ['Aldridge', 'DEL', 78], ['Quinn', 'DEL', 76], ['Cascarino', 'DEL', 72],
  ]),
  squad('tch1990', 'Checoslovaquia', 1990, '🏳️', 'Los Últimos Checoslovacos', '#D7141A', '#FFFFFF', [
    ['Stejskal', 'POR', 78],
    ['Kadlec', 'DEF', 76], ['Kocian', 'DEF', 70], ['Hašek', 'DEF', 78], ['Straka', 'DEF', 70],
    ['Chovanec', 'MED', 78], ['Moravčík', 'MED', 80], ['Bílek', 'MED', 74], ['Kubík', 'MED', 78],
    ['Skuhravý', 'DEL', 82], ['Knoflíček', 'DEL', 74], ['Griga', 'DEL', 70],
  ]),
  squad('yug1990', 'Yugoslavia', 1990, '🏳️', 'La Última Gran Yugoslavia', '#1B3D8F', '#FFFFFF', [
    ['Ivković', 'POR', 78],
    ['Stanojković', 'DEF', 70], ['Spasić', 'DEF', 74], ['Hadžibegić', 'DEF', 76], ['Jozić', 'DEF', 74],
    ['Brnović', 'DEF', 70],
    ['Katanec', 'MED', 78], ['Sušić', 'MED', 84], ['Stojković', 'MED', 90], ['Prosinečki', 'MED', 84],
    ['Savićević', 'DEL', 88], ['Pančev', 'DEL', 82], ['Vujović', 'DEL', 78],
  ]),
  // ---- cuartofinalistas 1994 ----
  squad('bul1994', 'Bulgaria', 1994, '🇧🇬', 'El Milagro Búlgaro', '#FFFFFF', '#00966E', [
    ['Mihaylov', 'POR', 80],
    ['Houbchev', 'DEF', 72], ['Ivanov T.', 'DEF', 74], ['Tzvetanov', 'DEF', 70], ['Kiriakov', 'DEF', 68],
    ['Letchkov', 'MED', 82], ['Balakov', 'MED', 84], ['Yankov', 'MED', 74], ['Sirakov', 'MED', 78],
    ['Stoichkov', 'DEL', 94], ['Kostadinov', 'DEL', 78], ['Borimirov', 'DEL', 68],
  ]),
  squad('swe1994', 'Suecia', 1994, '🇸🇪', 'El Bronce del 94', '#FFCC00', '#0050A0', [
    ['Ravelli', 'POR', 84],
    ['R. Nilsson', 'DEF', 76], ['P. Andersson', 'DEF', 78], ['Björklund', 'DEF', 76], ['Ljung', 'DEF', 72],
    ['Schwarz', 'MED', 78], ['Thern', 'MED', 80], ['Ingesson', 'MED', 76], ['Limpar', 'MED', 78],
    ['Brolin', 'DEL', 88], ['Dahlin', 'DEL', 82], ['K. Andersson', 'DEL', 82], ['Rydell', 'DEL', 68],
  ]),
  squad('ger1994', 'Alemania', 1994, '🇩🇪', 'Los del 94', '#FFFFFF', '#111111', [
    ['Illgner', 'POR', 84],
    ['Berthold', 'DEF', 76], ['Kohler', 'DEF', 86], ['Brehme', 'DEF', 82], ['Buchwald', 'DEF', 80],
    ['Sammer', 'MED', 86], ['Matthäus', 'MED', 88], ['Häßler', 'MED', 84], ['Möller', 'MED', 82],
    ['Effenberg', 'MED', 80],
    ['Klinsmann', 'DEL', 90], ['Völler', 'DEL', 82], ['Riedle', 'DEL', 76],
  ]),
  squad('esp1994', 'España', 1994, '🇪🇸', 'Los del Codazo de Tassotti', '#C8102E', '#FFC400', [
    ['Zubizarreta', 'POR', 84],
    ['Ferrer', 'DEF', 76], ['Nadal', 'DEF', 80], ['Abelardo', 'DEF', 78], ['Sergi', 'DEF', 78],
    ['Otero', 'DEF', 72],
    ['Hierro', 'MED', 86], ['Caminero', 'MED', 80], ['Goikoetxea', 'MED', 78], ['Bakero', 'MED', 76],
    ['Luis Enrique', 'MED', 84],
    ['Salinas', 'DEL', 76], ['Guerrero', 'DEL', 76], ['Felipe', 'DEL', 68],
  ]),
  squad('ned1994', 'Holanda', 1994, '🇳🇱', 'La Naranja del 94', '#F36C21', '#FFFFFF', [
    ['De Goey', 'POR', 78],
    ['Valckx', 'DEF', 72], ['R. Koeman', 'DEF', 88], ['F. de Boer', 'DEF', 82], ['Winter', 'DEF', 76],
    ['Rijkaard', 'MED', 88], ['Wouters', 'MED', 76], ['Jonk', 'MED', 78], ['Witschge', 'MED', 74],
    ['Bergkamp', 'DEL', 92], ['Overmars', 'DEL', 82], ['Van Vossen', 'DEL', 72], ['Roy', 'DEL', 74],
  ]),
  // ---- cuartofinalistas 1998 ----
  squad('cro1998', 'Croacia', 1998, '🇭🇷', 'El Bronce de Šuker', '#D52B1E', '#FFFFFF', [
    ['Ladić', 'POR', 78],
    ['Štimac', 'DEF', 78], ['Bilić', 'DEF', 78], ['Šimić', 'DEF', 76], ['Jarni', 'DEF', 80],
    ['Soldo', 'MED', 74], ['Asanović', 'MED', 82], ['Boban', 'MED', 88], ['Prosinečki', 'MED', 82],
    ['Šuker', 'DEL', 92], ['Vlaović', 'DEL', 76], ['Stanić', 'DEL', 74],
  ]),
  squad('ita1998', 'Italia', 1998, '🇮🇹', 'Los del 98', '#1A60A8', '#FFFFFF', [
    ['Pagliuca', 'POR', 84],
    ['Bergomi', 'DEF', 78], ['Cannavaro', 'DEF', 88], ['Costacurta', 'DEF', 84], ['Maldini', 'DEF', 90],
    ['Pessotto', 'DEF', 76], ['Torricelli', 'DEF', 72],
    ['Albertini', 'MED', 84], ['D. Baggio', 'MED', 80], ['Di Biagio', 'MED', 78], ['Moriero', 'MED', 74],
    ['R. Baggio', 'DEL', 90], ['Del Piero', 'DEL', 88], ['Vieri', 'DEL', 88], ['Inzaghi', 'DEL', 80],
  ]),
  squad('arg1998', 'Argentina', 1998, '🇦🇷', 'Los de Batistuta', '#75AADB', '#FFFFFF', [
    ['Roa', 'POR', 82],
    ['Ayala', 'DEF', 84], ['Chamot', 'DEF', 78], ['Sensini', 'DEF', 76], ['Vivas', 'DEF', 72],
    ['Zanetti', 'MED', 84], ['Almeyda', 'MED', 78], ['Simeone', 'MED', 84], ['Verón', 'MED', 86],
    ['Ortega', 'MED', 86], ['Gallardo', 'MED', 78],
    ['Batistuta', 'DEL', 92], ['C. López', 'DEL', 80], ['Crespo', 'DEL', 82], ['Delgado', 'DEL', 72],
  ]),
  squad('ger1998', 'Alemania', 1998, '🇩🇪', 'Los del 98', '#FFFFFF', '#111111', [
    ['Köpke', 'POR', 82],
    ['Wörns', 'DEF', 76], ['Kohler', 'DEF', 82], ['Babbel', 'DEF', 76], ['Heinrich', 'DEF', 72],
    ['Matthäus', 'MED', 82], ['Hamann', 'MED', 78], ['Jeremies', 'MED', 74], ['Häßler', 'MED', 78],
    ['Möller', 'MED', 78],
    ['Klinsmann', 'DEL', 84], ['Bierhoff', 'DEL', 84], ['Kirsten', 'DEL', 74], ['Marschall', 'DEL', 68],
  ]),
  squad('den1998', 'Dinamarca', 1998, '🇩🇰', 'La Dinamita de los Laudrup', '#C8102E', '#FFFFFF', [
    ['Schmeichel', 'POR', 92],
    ['Helveg', 'DEF', 76], ['Rieper', 'DEF', 76], ['Høgh', 'DEF', 72], ['Heintze', 'DEF', 72],
    ['Nielsen A.', 'MED', 70], ['Jørgensen', 'MED', 76], ['M. Laudrup', 'MED', 92], ['Tøfting', 'MED', 70],
    ['B. Laudrup', 'DEL', 90], ['Sand', 'DEL', 76], ['Møller', 'DEL', 74],
  ]),
  // ---- cuartofinalistas 2002 ----
  squad('ger2002', 'Alemania', 2002, '🇩🇪', 'Los de Kahn', '#FFFFFF', '#111111', [
    ['Kahn', 'POR', 94],
    ['Linke', 'DEF', 76], ['Ramelow', 'DEF', 76], ['Metzelder', 'DEF', 78], ['Frings', 'DEF', 78],
    ['Hamann', 'MED', 80], ['Ballack', 'MED', 90], ['Schneider', 'MED', 80], ['Jeremies', 'MED', 72],
    ['Bode', 'MED', 70],
    ['Klose', 'DEL', 84], ['Neuville', 'DEL', 78], ['Jancker', 'DEL', 72], ['Bierhoff', 'DEL', 74],
  ]),
  squad('tur2002', 'Turquía', 2002, '🇹🇷', 'El Bronce Turco', '#E30A17', '#FFFFFF', [
    ['Rüştü', 'POR', 86],
    ['Alpay', 'DEF', 78], ['Bülent', 'DEF', 74], ['Fatih', 'DEF', 70], ['Ergün', 'DEF', 70],
    ['Emre', 'MED', 80], ['Baştürk', 'MED', 82], ['Tugay', 'MED', 78], ['Davala', 'MED', 76],
    ['Hasan Şaş', 'MED', 80],
    ['Hakan Şükür', 'DEL', 84], ['Mansız', 'DEL', 78], ['Hakan Ünsal', 'DEL', 68],
  ]),
  squad('kor2002', 'Corea del Sur', 2002, '🇰🇷', 'Los Semifinalistas de Casa', '#CD2E3A', '#0047A0', [
    ['Lee Woon-jae', 'POR', 80],
    ['Hong Myung-bo', 'DEF', 86], ['Choi Jin-cheul', 'DEF', 76], ['Kim Tae-young', 'DEF', 74],
    ['Lee Young-pyo', 'DEF', 78],
    ['Yoo Sang-chul', 'MED', 78], ['Kim Nam-il', 'MED', 76], ['Song Chong-gug', 'MED', 76],
    ['Park Ji-sung', 'MED', 84],
    ['Ahn Jung-hwan', 'DEL', 80], ['Seol Ki-hyeon', 'DEL', 76], ['Lee Chun-soo', 'DEL', 74],
    ['Hwang Sun-hong', 'DEL', 74],
  ]),
  squad('esp2002', 'España', 2002, '🇪🇸', 'Los de Raúl', '#C8102E', '#FFC400', [
    ['Casillas', 'POR', 86],
    ['Puyol', 'DEF', 82], ['Hierro', 'DEF', 82], ['Nadal', 'DEF', 76], ['Juanfran', 'DEF', 72],
    ['Helguera', 'MED', 80], ['Baraja', 'MED', 80], ['Valerón', 'MED', 84], ['Mendieta', 'MED', 82],
    ['De Pedro', 'MED', 74], ['Joaquín', 'MED', 80],
    ['Raúl', 'DEL', 90], ['Morientes', 'DEL', 86], ['Tristán', 'DEL', 76], ['Luis Enrique', 'DEL', 78],
  ]),
  squad('eng2002', 'Inglaterra', 2002, '🏴', 'Los de Beckham', '#FFFFFF', '#1B3D8F', [
    ['Seaman', 'POR', 82],
    ['Mills', 'DEF', 72], ['Ferdinand', 'DEF', 84], ['Campbell', 'DEF', 82], ['A. Cole', 'DEF', 80],
    ['Beckham', 'MED', 88], ['Scholes', 'MED', 86], ['Butt', 'MED', 76], ['Sinclair', 'MED', 70],
    ['Owen', 'DEL', 88], ['Heskey', 'DEL', 76], ['Sheringham', 'DEL', 76], ['Vassell', 'DEL', 70],
  ]),
  squad('usa2002', 'Estados Unidos', 2002, '🇺🇸', 'La Sorpresa Yanqui', '#FFFFFF', '#3C3B6E', [
    ['Friedel', 'POR', 84],
    ['Sanneh', 'DEF', 72], ['Pope', 'DEF', 74], ['Agoos', 'DEF', 70], ['Hejduk', 'DEF', 72],
    ['Reyna', 'MED', 80], ["O'Brien", 'MED', 76], ['Mastroeni', 'MED', 70], ['Beasley', 'MED', 76],
    ['Donovan', 'DEL', 82], ['McBride', 'DEL', 78], ['Mathis', 'DEL', 72], ['Wolff', 'DEL', 66],
  ]),
  squad('sen2002', 'Senegal', 2002, '🇸🇳', 'Los Leones de Teranga', '#FFFFFF', '#00853F', [
    ['Sylva', 'POR', 76],
    ['Coly', 'DEF', 72], ['Daf', 'DEF', 70], ['Diatta', 'DEF', 76], ['P. Malick Diop', 'DEF', 70],
    ['Cissé', 'MED', 74], ['Diao', 'MED', 74], ['P.B. Diop', 'MED', 80], ['N\'Diaye', 'MED', 68],
    ['Diouf', 'DEL', 84], ['H. Camara', 'DEL', 80], ['Fadiga', 'DEL', 78], ['Diallo', 'DEL', 68],
  ]),
  // ---- cuartofinalistas 2006 ----
  squad('ger2006', 'Alemania', 2006, '🇩🇪', 'El Verano de Cuento', '#FFFFFF', '#111111', [
    ['Lehmann', 'POR', 86],
    ['Friedrich', 'DEF', 76], ['Mertesacker', 'DEF', 80], ['Metzelder', 'DEF', 78], ['Lahm', 'DEF', 84],
    ['Frings', 'MED', 80], ['Ballack', 'MED', 88], ['Schweinsteiger', 'MED', 80], ['Schneider', 'MED', 78],
    ['Borowski', 'MED', 74],
    ['Klose', 'DEL', 88], ['Podolski', 'DEL', 82], ['Neuville', 'DEL', 74], ['Odonkor', 'DEL', 70],
  ]),
  squad('por2006', 'Portugal', 2006, '🇵🇹', 'Los de Figo y Cristiano', '#C8102E', '#006847', [
    ['Ricardo', 'POR', 80],
    ['Miguel', 'DEF', 78], ['R. Carvalho', 'DEF', 84], ['Meira', 'DEF', 74], ['Valente', 'DEF', 74],
    ['Costinha', 'MED', 74], ['Maniche', 'MED', 82], ['Deco', 'MED', 88], ['Petit', 'MED', 74],
    ['Tiago', 'MED', 76],
    ['Figo', 'DEL', 88], ['C. Ronaldo', 'DEL', 88], ['Pauleta', 'DEL', 80], ['Simão', 'DEL', 78],
  ]),
  squad('bra2006', 'Brasil', 2006, '🇧🇷', 'El Cuadrado Mágico', '#FFD700', '#1B7A3D', [
    ['Dida', 'POR', 84],
    ['Cafú', 'DEF', 82], ['Lúcio', 'DEF', 86], ['Juan', 'DEF', 80], ['Roberto Carlos', 'DEF', 84],
    ['Emerson', 'MED', 80], ['Gilberto Silva', 'MED', 80], ['Zé Roberto', 'MED', 80],
    ['Kaká', 'MED', 90], ['Ronaldinho', 'MED', 92],
    ['Ronaldo', 'DEL', 86], ['Adriano', 'DEL', 84], ['Robinho', 'DEL', 80], ['Fred', 'DEL', 74],
  ]),
  squad('arg2006', 'Argentina', 2006, '🇦🇷', 'Los de Riquelme', '#75AADB', '#FFFFFF', [
    ['Abbondanzieri', 'POR', 80],
    ['Ayala', 'DEF', 84], ['Heinze', 'DEF', 80], ['Burdisso', 'DEF', 76], ['Sorín', 'DEF', 80],
    ['Coloccini', 'DEF', 74], ['Scaloni', 'DEF', 70],
    ['Mascherano', 'MED', 82], ['Cambiasso', 'MED', 82], ['Riquelme', 'MED', 90], ['Aimar', 'MED', 80],
    ['Maxi Rodríguez', 'MED', 80],
    ['Crespo', 'DEL', 86], ['Tevez', 'DEL', 84], ['Messi', 'DEL', 84], ['Saviola', 'DEL', 78],
  ]),
  squad('eng2006', 'Inglaterra', 2006, '🏴', 'La Generación Dorada Inglesa', '#FFFFFF', '#1B3D8F', [
    ['Robinson', 'POR', 78],
    ['G. Neville', 'DEF', 78], ['Ferdinand', 'DEF', 86], ['Terry', 'DEF', 86], ['A. Cole', 'DEF', 82],
    ['Beckham', 'MED', 84], ['Lampard', 'MED', 86], ['Gerrard', 'MED', 88], ['J. Cole', 'MED', 80],
    ['Hargreaves', 'MED', 78], ['Carragher', 'DEF', 78],
    ['Rooney', 'DEL', 88], ['Owen', 'DEL', 80], ['Crouch', 'DEL', 76],
  ]),
  squad('ukr2006', 'Ucrania', 2006, '🇺🇦', 'Los de Sheva', '#FFD500', '#005BBB', [
    ['Shovkovskyi', 'POR', 80],
    ['Nesmachniy', 'DEF', 72], ['Rusol', 'DEF', 72], ['Sviderskyi', 'DEF', 66], ['Yezerskyi', 'DEF', 66],
    ['Tymoshchuk', 'MED', 80], ['Husyev', 'MED', 76], ['Kalynychenko', 'MED', 74], ['Rotan', 'MED', 72],
    ['Shevchenko', 'DEL', 90], ['Voronin', 'DEL', 78], ['Rebrov', 'DEL', 76], ['Milevskyi', 'DEL', 70],
  ]),
  // ---- cuartofinalistas 2010 ----
  squad('ger2010', 'Alemania', 2010, '🇩🇪', 'La Aplanadora Joven', '#FFFFFF', '#111111', [
    ['Neuer', 'POR', 86],
    ['Friedrich', 'DEF', 76], ['Mertesacker', 'DEF', 80], ['Boateng', 'DEF', 78], ['Lahm', 'DEF', 88],
    ['Khedira', 'MED', 80], ['Schweinsteiger', 'MED', 86], ['Özil', 'MED', 84], ['Kroos', 'MED', 76],
    ['Trochowski', 'MED', 72],
    ['T. Müller', 'DEL', 84], ['Klose', 'DEL', 84], ['Podolski', 'DEL', 80], ['Cacau', 'DEL', 72],
  ]),
  squad('bra2010', 'Brasil', 2010, '🇧🇷', 'Los de Dunga', '#FFD700', '#1B7A3D', [
    ['Julio César', 'POR', 88],
    ['Maicon', 'DEF', 86], ['Lúcio', 'DEF', 84], ['Juan', 'DEF', 78], ['Bastos', 'DEF', 74],
    ['Dani Alves', 'DEF', 84],
    ['Gilberto Silva', 'MED', 78], ['Felipe Melo', 'MED', 76], ['Elano', 'MED', 78], ['Kaká', 'MED', 86],
    ['Robinho', 'DEL', 82], ['Luís Fabiano', 'DEL', 82], ['Nilmar', 'DEL', 74], ['Grafite', 'DEL', 72],
  ]),
  squad('arg2010', 'Argentina', 2010, '🇦🇷', 'Los del Diego DT', '#75AADB', '#FFFFFF', [
    ['Romero', 'POR', 78],
    ['Otamendi', 'DEF', 76], ['Demichelis', 'DEF', 78], ['Samuel', 'DEF', 80], ['Heinze', 'DEF', 78],
    ['Burdisso', 'DEF', 74],
    ['Mascherano', 'MED', 86], ['Verón', 'MED', 78], ['Maxi Rodríguez', 'MED', 78], ['Di María', 'MED', 82],
    ['Messi', 'DEL', 94], ['Higuaín', 'DEL', 84], ['Tevez', 'DEL', 84], ['Agüero', 'DEL', 82],
    ['Milito', 'DEL', 80], ['Palermo', 'DEL', 72],
  ]),
  squad('gha2010', 'Ghana', 2010, '🇬🇭', 'Las Estrellas Negras', '#FFFFFF', '#CE1126', [
    ['Kingson', 'POR', 74],
    ['Pantsil', 'DEF', 72], ['J. Mensah', 'DEF', 76], ['Vorsah', 'DEF', 72], ['Sarpei', 'DEF', 70],
    ['Inkoom', 'DEF', 70],
    ['Annan', 'MED', 76], ['K.P. Boateng', 'MED', 80], ['Asamoah', 'MED', 78], ['Appiah', 'MED', 74],
    ['Muntari', 'MED', 78],
    ['Gyan', 'DEL', 84], ['A. Ayew', 'DEL', 78], ['Tagoe', 'DEL', 68],
  ]),
  squad('par2010', 'Paraguay', 2010, '🇵🇾', 'La Albirroja Histórica', '#D52B1E', '#FFFFFF', [
    ['Villar', 'POR', 80],
    ['Verón D.', 'DEF', 74], ['Alcaraz', 'DEF', 76], ['Da Silva', 'DEF', 74], ['Morel', 'DEF', 72],
    ['Bonet', 'DEF', 70],
    ['Vera', 'MED', 74], ['V. Cáceres', 'MED', 72], ['Riveros', 'MED', 78], ['Ortigoza', 'MED', 72],
    ['Santa Cruz', 'DEL', 80], ['Cardozo', 'DEL', 78], ['Valdez', 'DEL', 76], ['Barrios', 'DEL', 76],
  ]),
  // ---- cuartofinalistas 2014 ----
  squad('bra2014', 'Brasil', 2014, '🇧🇷', 'Los del Mineirazo', '#FFD700', '#1B7A3D', [
    ['Julio César', 'POR', 80],
    ['Dani Alves', 'DEF', 82], ['Thiago Silva', 'DEF', 88], ['David Luiz', 'DEF', 80], ['Marcelo', 'DEF', 84],
    ['Maicon', 'DEF', 76],
    ['Fernandinho', 'MED', 80], ['Paulinho', 'MED', 78], ['Ramires', 'MED', 76], ['Willian', 'MED', 78],
    ['Neymar', 'DEL', 90], ['Hulk', 'DEL', 80], ['Fred', 'DEL', 72], ['Jô', 'DEL', 68],
  ]),
  squad('ned2014', 'Holanda', 2014, '🇳🇱', 'La Naranja del 5-1', '#F36C21', '#FFFFFF', [
    ['Cillessen', 'POR', 80],
    ['De Vrij', 'DEF', 80], ['Vlaar', 'DEF', 76], ['Martins Indi', 'DEF', 74], ['Janmaat', 'DEF', 76],
    ['Blind', 'DEF', 80],
    ['N. de Jong', 'MED', 78], ['Wijnaldum', 'MED', 78], ['Sneijder', 'MED', 84], ['Depay', 'MED', 76],
    ['Robben', 'DEL', 92], ['Van Persie', 'DEL', 88], ['Kuyt', 'DEL', 78], ['Huntelaar', 'DEL', 76],
  ]),
  squad('fra2014', 'Francia', 2014, '🇫🇷', 'Los de Brasil 2014', '#1B3D8F', '#FFFFFF', [
    ['Lloris', 'POR', 84],
    ['Debuchy', 'DEF', 76], ['Varane', 'DEF', 82], ['Sakho', 'DEF', 76], ['Evra', 'DEF', 78],
    ['Koscielny', 'DEF', 78],
    ['Pogba', 'MED', 82], ['Cabaye', 'MED', 78], ['Matuidi', 'MED', 80], ['Sissoko', 'MED', 74],
    ['Valbuena', 'MED', 78],
    ['Benzema', 'DEL', 88], ['Griezmann', 'DEL', 80], ['Giroud', 'DEL', 78], ['Rémy', 'DEL', 72],
  ]),
  squad('bel2014', 'Bélgica', 2014, '🇧🇪', 'Los Diablos del 14', '#ED2939', '#1B1A17', [
    ['Courtois', 'POR', 86],
    ['Alderweireld', 'DEF', 80], ['Kompany', 'DEF', 86], ['Vertonghen', 'DEF', 80], ['Van Buyten', 'DEF', 74],
    ['Witsel', 'MED', 80], ['Fellaini', 'MED', 78], ['De Bruyne', 'MED', 84], ['M. Dembélé', 'MED', 78],
    ['Chadli', 'MED', 74],
    ['E. Hazard', 'DEL', 88], ['Lukaku', 'DEL', 80], ['Mertens', 'DEL', 80], ['Mirallas', 'DEL', 76],
    ['Origi', 'DEL', 72],
  ]),
  squad('crc2014', 'Costa Rica', 2014, '🇨🇷', 'El Milagro Tico', '#CE1126', '#FFFFFF', [
    ['K. Navas', 'POR', 88],
    ['Gamboa', 'DEF', 72], ['G. González', 'DEF', 76], ['Umaña', 'DEF', 72], ['Duarte', 'DEF', 74],
    ['Acosta', 'DEF', 70],
    ['Borges', 'MED', 76], ['Tejeda', 'MED', 74], ['Bolaños', 'MED', 74], ['B. Ruiz', 'MED', 80],
    ['Campbell', 'DEL', 80], ['Ureña', 'DEL', 72], ['Bekeles', 'DEL', 64],
  ]),
  // ---- cuartofinalistas 2018 ----
  squad('eng2018', 'Inglaterra', 2018, '🏴', 'Los del Football\'s Coming Home', '#FFFFFF', '#1B3D8F', [
    ['Pickford', 'POR', 82],
    ['K. Walker', 'DEF', 82], ['Stones', 'DEF', 82], ['Maguire', 'DEF', 80], ['Trippier', 'DEF', 80],
    ['Young', 'DEF', 74], ['Rose', 'DEF', 72],
    ['Henderson', 'MED', 80], ['Alli', 'MED', 80], ['Lingard', 'MED', 76], ['Loftus-Cheek', 'MED', 72],
    ['Kane', 'DEL', 90], ['Sterling', 'DEL', 84], ['Rashford', 'DEL', 78], ['Vardy', 'DEL', 78],
  ]),
  squad('bra2018', 'Brasil', 2018, '🇧🇷', 'Los de Rusia 2018', '#FFD700', '#1B7A3D', [
    ['Alisson', 'POR', 86],
    ['Fagner', 'DEF', 74], ['Thiago Silva', 'DEF', 86], ['Miranda', 'DEF', 82], ['Marquinhos', 'DEF', 82],
    ['Filipe Luís', 'DEF', 78],
    ['Casemiro', 'MED', 86], ['Paulinho', 'MED', 78], ['Fernandinho', 'MED', 78], ['Coutinho', 'MED', 86],
    ['Willian', 'MED', 80],
    ['Neymar', 'DEL', 92], ['G. Jesus', 'DEL', 80], ['Firmino', 'DEL', 84], ['Douglas Costa', 'DEL', 78],
  ]),
  squad('uru2018', 'Uruguay', 2018, '🇺🇾', 'La Garra de Rusia', '#5CB8E4', '#1B1A17', [
    ['Muslera', 'POR', 82],
    ['Godín', 'DEF', 88], ['Giménez', 'DEF', 84], ['Cáceres', 'DEF', 76], ['Laxalt', 'DEF', 74],
    ['C. Sánchez', 'DEF', 72],
    ['Bentancur', 'MED', 80], ['Vecino', 'MED', 78], ['Torreira', 'MED', 78], ['Nández', 'MED', 76],
    ['Suárez', 'DEL', 90], ['Cavani', 'DEL', 90], ['Stuani', 'DEL', 74], ['M. Gómez', 'DEL', 74],
  ]),
  squad('swe2018', 'Suecia', 2018, '🇸🇪', 'Los Sin Zlatan', '#FFCC00', '#0050A0', [
    ['Olsen', 'POR', 80],
    ['Lustig', 'DEF', 74], ['Granqvist', 'DEF', 80], ['Lindelöf', 'DEF', 80], ['Augustinsson', 'DEF', 76],
    ['Jansson', 'DEF', 72],
    ['Claesson', 'MED', 76], ['Ekdal', 'MED', 76], ['Forsberg', 'MED', 82], ['Larsson S.', 'MED', 74],
    ['Berg', 'DEL', 76], ['Toivonen', 'DEL', 74], ['Thelin', 'DEL', 70], ['Guidetti', 'DEL', 68],
  ]),
  squad('rus2018', 'Rusia', 2018, '🇷🇺', 'Los Anfitriones del 18', '#E4181C', '#FFFFFF', [
    ['Akinfeev', 'POR', 82],
    ['M. Fernandes', 'DEF', 78], ['Ignashevich', 'DEF', 74], ['Kutepov', 'DEF', 72], ['Zhirkov', 'DEF', 74],
    ['Kudryashov', 'DEF', 70],
    ['Zobnin', 'MED', 74], ['Golovin', 'MED', 82], ['Samedov', 'MED', 74], ['Kuzyaev', 'MED', 72],
    ['Dzyuba', 'DEL', 80], ['Cheryshev', 'DEL', 80], ['Smolov', 'DEL', 74], ['Miranchuk Al.', 'DEL', 70],
  ]),
  // ---- cuartofinalistas 2022 ----
  squad('bra2022', 'Brasil', 2022, '🇧🇷', 'Los de Catar', '#FFD700', '#1B7A3D', [
    ['Alisson', 'POR', 88], ['Ederson', 'POR', 86],
    ['Danilo', 'DEF', 78], ['Marquinhos', 'DEF', 86], ['Thiago Silva', 'DEF', 84], ['Militão', 'DEF', 82],
    ['Alex Sandro', 'DEF', 78],
    ['Casemiro', 'MED', 88], ['Bruno Guimarães', 'MED', 80], ['Paquetá', 'MED', 80],
    ['Neymar', 'DEL', 90], ['Vini Jr', 'DEL', 88], ['Richarlison', 'DEL', 82], ['Raphinha', 'DEL', 80],
    ['Rodrygo', 'DEL', 82], ['Antony', 'DEL', 76],
  ]),
  squad('ned2022', 'Holanda', 2022, '🇳🇱', 'La Naranja de Van Gaal', '#F36C21', '#FFFFFF', [
    ['Noppert', 'POR', 76],
    ['Van Dijk', 'DEF', 90], ['De Ligt', 'DEF', 82], ['Aké', 'DEF', 80], ['Timber', 'DEF', 78],
    ['Dumfries', 'DEF', 80], ['Blind', 'DEF', 74],
    ['F. de Jong', 'MED', 86], ['Klaassen', 'MED', 74], ['Koopmeiners', 'MED', 76],
    ['Gakpo', 'DEL', 84], ['Depay', 'DEL', 82], ['Bergwijn', 'DEL', 76], ['Janssen', 'DEL', 70],
  ]),
  squad('eng2022', 'Inglaterra', 2022, '🏴', 'Los de Catar 2022', '#FFFFFF', '#1B3D8F', [
    ['Pickford', 'POR', 82],
    ['K. Walker', 'DEF', 80], ['Stones', 'DEF', 82], ['Maguire', 'DEF', 78], ['Shaw', 'DEF', 78],
    ['Trippier', 'DEF', 80],
    ['Rice', 'MED', 84], ['Bellingham', 'MED', 86], ['Henderson', 'MED', 78], ['Mount', 'MED', 78],
    ['Foden', 'DEL', 84], ['Saka', 'DEL', 84], ['Kane', 'DEL', 90], ['Sterling', 'DEL', 80],
    ['Rashford', 'DEL', 80], ['Grealish', 'DEL', 78],
  ]),
  squad('por2022', 'Portugal', 2022, '🇵🇹', 'La Última de CR7', '#C8102E', '#006847', [
    ['Diogo Costa', 'POR', 82],
    ['Cancelo', 'DEF', 84], ['Pepe', 'DEF', 80], ['Rúben Dias', 'DEF', 86], ['Guerreiro', 'DEF', 78],
    ['Dalot', 'DEF', 76],
    ['Vitinha', 'MED', 78], ['Otávio', 'MED', 76], ['B. Fernandes', 'MED', 88], ['Bernardo Silva', 'MED', 88],
    ['C. Ronaldo', 'DEL', 84], ['João Félix', 'DEL', 82], ['Rafael Leão', 'DEL', 82], ['G. Ramos', 'DEL', 78],
  ]),
  squad('cro2022', 'Croacia', 2022, '🇭🇷', 'El Bronce de Catar', '#D52B1E', '#FFFFFF', [
    ['Livaković', 'POR', 84],
    ['Juranović', 'DEF', 78], ['Lovren', 'DEF', 76], ['Gvardiol', 'DEF', 86], ['Sosa', 'DEF', 76],
    ['Stanišić', 'DEF', 74],
    ['Modrić', 'MED', 90], ['Brozović', 'MED', 82], ['Kovačić', 'MED', 84], ['Majer', 'MED', 76],
    ['Pašalić', 'MED', 76],
    ['Perišić', 'DEL', 84, [['MI', 84], ['EI', 84], ['ED', 84]]], ['Kramarić', 'DEL', 80], ['Oršić', 'DEL', 76], ['Petković', 'DEL', 74],
    ['Livaja', 'DEL', 74],
  ]),
];

// ============================================================================
// MODO "MUNDIAL 2026": las 48 selecciones clasificadas al Mundial de
// Canadá-México-EE.UU. Estos planteles SOLO se usan en el modo "mundial2026"
// (no aparecen en Clásico, Almanaque ni Solo Penales). Niveles realistas con
// tope ~94 (Mbappé), basados en el rendimiento actual de cada jugador.
// ============================================================================
export const SQUADS_2026 = [
  // ---------- Candidatos ----------
  squad('arg2026', 'Argentina', 2026, '🇦🇷', 'La Scaloneta', '#75AADB', '#FFFFFF', [
    ['E. Martínez', 'POR', 90], ['G. Rulli', 'POR', 76],
    ['Molina', 'DEF', 80, [['LD', 80]]], ['Cuti Romero', 'DEF', 88, [['DFC', 88]]],
    ['L. Martínez', 'DEF', 85, [['DFC', 85]]], ['Otamendi', 'DEF', 81, [['DFC', 81]]],
    ['Tagliafico', 'DEF', 79, [['LI', 79]]], ['Acuña', 'DEF', 78, [['LI', 78]]],
    ['Montiel', 'DEF', 76, [['LD', 76]]],
    ['De Paul', 'MED', 84], ['Mac Allister', 'MED', 87], ['Enzo Fernández', 'MED', 86],
    ['Paredes', 'MED', 79], ['Lo Celso', 'MED', 80], ['Palacios', 'MED', 79],
    ['Messi', 'DEL', 92, [['MCO', 92], ['ED', 92], ['EI', 91]]],
    ['J. Álvarez', 'DEL', 88, [['DC', 88]]], ['Lautaro Martínez', 'DEL', 88, [['DC', 88]]],
    ['Garnacho', 'DEL', 81, [['EI', 81], ['ED', 81]]], ['Nico González', 'DEL', 80, [['ED', 80], ['EI', 80]]],
    ['Almada', 'DEL', 79, [['MCO', 79], ['EI', 79]]],
  ]),
  squad('fra2026', 'Francia', 2026, '🇫🇷', 'Les Bleus', '#1B3D8F', '#FFFFFF', [
    ['Maignan', 'POR', 88], ['Samba', 'POR', 76],
    ['Koundé', 'DEF', 84, [['LD', 84], ['DFC', 84]]], ['Saliba', 'DEF', 86, [['DFC', 86]]],
    ['Upamecano', 'DEF', 83, [['DFC', 83]]], ['Konaté', 'DEF', 82, [['DFC', 82]]],
    ['T. Hernández', 'DEF', 84, [['LI', 84]]], ['L. Hernández', 'DEF', 81, [['LI', 81], ['DFC', 81]]],
    ['Pavard', 'DEF', 82, [['LD', 82], ['DFC', 82]]],
    ['Tchouaméni', 'MED', 86], ['Camavinga', 'MED', 85], ['Rabiot', 'MED', 81],
    ['Zaïre-Emery', 'MED', 80], ['Fofana', 'MED', 78],
    ['Mbappé', 'DEL', 94, [['EI', 94], ['DC', 93]]], ['Dembélé', 'DEL', 87, [['ED', 87], ['DC', 86]]],
    ['Griezmann', 'DEL', 87, [['MCO', 87], ['DC', 86]]], ['Olise', 'DEL', 84, [['ED', 84], ['MD', 83]]],
    ['Thuram', 'DEL', 83, [['DC', 83]]], ['Kolo Muani', 'DEL', 81, [['DC', 81]]],
    ['Barcola', 'DEL', 81, [['EI', 81], ['ED', 81]]],
  ]),
  squad('bra2026', 'Brasil', 2026, '🇧🇷', 'A Seleção', '#FFD700', '#1B7A3D', [
    ['Alisson', 'POR', 88], ['Ederson', 'POR', 84],
    ['Danilo', 'DEF', 78, [['LD', 78], ['DFC', 78]]], ['Marquinhos', 'DEF', 85, [['DFC', 85]]],
    ['Gabriel Magalhães', 'DEF', 84, [['DFC', 84]]], ['Militão', 'DEF', 84, [['DFC', 84], ['LD', 83]]],
    ['Wendell', 'DEF', 75, [['LI', 75]]], ['Vanderson', 'DEF', 77, [['LD', 77]]],
    ['Bruno Guimarães', 'MED', 85], ['Lucas Paquetá', 'MED', 82], ['André', 'MED', 78],
    ['Joelinton', 'MED', 78], ['Gerson', 'MED', 77],
    ['Vinícius Jr.', 'DEL', 92, [['EI', 92]]], ['Rodrygo', 'DEL', 87, [['ED', 87], ['EI', 87]]],
    ['Raphinha', 'DEL', 86, [['ED', 86], ['EI', 85]]], ['Endrick', 'DEL', 81, [['DC', 81]]],
    ['Martinelli', 'DEL', 81, [['EI', 81]]], ['Matheus Cunha', 'DEL', 80, [['DC', 80]]],
    ['Pedro', 'DEL', 80, [['DC', 80]]],
  ]),
  squad('esp2026', 'España', 2026, '🇪🇸', 'La Roja', '#C60B1E', '#FFC400', [
    ['Unai Simón', 'POR', 84], ['Raya', 'POR', 83],
    ['Carvajal', 'DEF', 83, [['LD', 83]]], ['Le Normand', 'DEF', 81, [['DFC', 81]]],
    ['Cubarsí', 'DEF', 82, [['DFC', 82]]], ['Laporte', 'DEF', 81, [['DFC', 81]]],
    ['Cucurella', 'DEF', 80, [['LI', 80]]], ['Balde', 'DEF', 80, [['LI', 80]]],
    ['Rodri', 'MED', 91], ['Pedri', 'MED', 89], ['Gavi', 'MED', 84],
    ['Fabián Ruiz', 'MED', 82], ['Zubimendi', 'MED', 81], ['Dani Olmo', 'MED', 84, [['MCO', 84]]],
    ['Lamine Yamal', 'DEL', 90, [['ED', 90]]], ['Nico Williams', 'DEL', 86, [['EI', 86]]],
    ['Oyarzabal', 'DEL', 82, [['DC', 82], ['EI', 81]]], ['Morata', 'DEL', 80, [['DC', 80]]],
    ['Ferran Torres', 'DEL', 80, [['EI', 80], ['DC', 79]]],
  ]),
  squad('eng2026', 'Inglaterra', 2026, '🏴', 'The Three Lions', '#FFFFFF', '#0A2342', [
    ['Pickford', 'POR', 83], ['Henderson', 'POR', 76],
    ['Alexander-Arnold', 'DEF', 84, [['LD', 84]]], ['Stones', 'DEF', 84, [['DFC', 84]]],
    ['Guéhi', 'DEF', 81, [['DFC', 81]]], ['Konsa', 'DEF', 77, [['DFC', 77]]],
    ['Shaw', 'DEF', 79, [['LI', 79]]], ['Colwill', 'DEF', 79, [['DFC', 79], ['LI', 78]]],
    ['K. Walker', 'DEF', 79, [['LD', 79]]],
    ['Bellingham', 'MED', 90], ['Rice', 'MED', 86], ['Foden', 'MED', 87],
    ['C. Palmer', 'MED', 86], ['Mainoo', 'MED', 80], ['Gallagher', 'MED', 78],
    ['Kane', 'DEL', 89, [['DC', 89]]], ['Saka', 'DEL', 88, [['ED', 88]]],
    ['Rashford', 'DEL', 81, [['EI', 81], ['DC', 80]]], ['Gordon', 'DEL', 80, [['EI', 80]]],
    ['Watkins', 'DEL', 81, [['DC', 81]]], ['Bowen', 'DEL', 79, [['ED', 79]]],
  ]),
  squad('por2026', 'Portugal', 2026, '🇵🇹', 'As Quinas', '#006600', '#FF0000', [
    ['Diogo Costa', 'POR', 84], ['José Sá', 'POR', 76],
    ['Cancelo', 'DEF', 83, [['LD', 83], ['LI', 83]]], ['Rúben Dias', 'DEF', 86, [['DFC', 86]]],
    ['Gonçalo Inácio', 'DEF', 80, [['DFC', 80]]], ['António Silva', 'DEF', 79, [['DFC', 79]]],
    ['Nuno Mendes', 'DEF', 84, [['LI', 84]]], ['Dalot', 'DEF', 80, [['LD', 80]]],
    ['Bruno Fernandes', 'MED', 88], ['Bernardo Silva', 'MED', 87], ['Vitinha', 'MED', 84],
    ['João Neves', 'MED', 82], ['Rúben Neves', 'MED', 80], ['Otávio', 'MED', 76],
    ['Rafael Leão', 'DEL', 85, [['EI', 85]]], ['C. Ronaldo', 'DEL', 83, [['DC', 83]]],
    ['Diogo Jota', 'DEL', 82, [['DC', 82], ['EI', 81]]], ['João Félix', 'DEL', 81, [['MCO', 81], ['DC', 80]]],
    ['Gonçalo Ramos', 'DEL', 80, [['DC', 80]]], ['Pedro Neto', 'DEL', 81, [['ED', 81], ['EI', 81]]],
  ]),

  // ---------- Sudamérica ----------
  squad('uru2026', 'Uruguay', 2026, '🇺🇾', 'La Celeste', '#5BA3D0', '#FFFFFF', [
    ['Rochet', 'POR', 80], ['Sergio Rossi', 'POR', 72],
    ['Araújo', 'DEF', 85], ['Giménez', 'DEF', 85], ['Olivera', 'DEF', 78], ['Nández', 'DEF', 79],
    ['Cáceres', 'DEF', 73], ['Viña', 'DEF', 76], ['Varela', 'DEF', 75],
    ['Valverde', 'MED', 89], ['Bentancur', 'MED', 83], ['Ugarte', 'MED', 81],
    ['De Arrascaeta', 'MED', 83], ['De la Cruz', 'MED', 82],
    ['Darwin Núñez', 'DEL', 85], ['Pellistri', 'DEL', 77], ['Brian Rodríguez', 'DEL', 75],
    ['Maxi Araújo', 'DEL', 74], ['Cavani', 'DEL', 75],
  ]),
  squad('col2026', 'Colombia', 2026, '🇨🇴', 'Los Cafeteros', '#FCD116', '#003893', [
    ['Camilo Vargas', 'POR', 78], ['Montero', 'POR', 73],
    ['D. Muñoz', 'DEF', 80], ['Lucumí', 'DEF', 78], ['Cuesta', 'DEF', 77], ['Mojica', 'DEF', 76],
    ['Yerry Mina', 'DEF', 78], ['Dávinson Sánchez', 'DEF', 78],
    ['James Rodríguez', 'MED', 84], ['Lerma', 'MED', 79], ['Richard Ríos', 'MED', 80],
    ['Castaño', 'MED', 76], ['Uribe', 'MED', 76],
    ['Luis Díaz', 'DEL', 88], ['Jhon Córdoba', 'DEL', 80], ['Jhon Durán', 'DEL', 80],
    ['Sinisterra', 'DEL', 78], ['Cuadrado', 'DEL', 75],
  ]),
  squad('ecu2026', 'Ecuador', 2026, '🇪🇨', 'La Tri', '#FFDD00', '#0072CE', [
    ['Galíndez', 'POR', 77], ['Domínguez', 'POR', 73],
    ['Pacho', 'DEF', 82], ['Hincapié', 'DEF', 83], ['Félix Torres', 'DEF', 77], ['Estupiñán', 'DEF', 79],
    ['Preciado', 'DEF', 75], ['Porozo', 'DEF', 73],
    ['Moisés Caicedo', 'MED', 87], ['Alan Franco', 'MED', 76], ['Vite', 'MED', 74],
    ['Gruezo', 'MED', 74], ['Páez', 'MED', 77],
    ['Enner Valencia', 'DEL', 78], ['Plata', 'DEL', 79], ['Kevin Rodríguez', 'DEL', 74],
    ['Estrada', 'DEL', 73],
  ]),
  squad('par2026', 'Paraguay', 2026, '🇵🇾', 'La Albirroja', '#D52B1E', '#0038A8', [
    ['Coronel', 'POR', 76], ['Servío', 'POR', 71],
    ['Gustavo Gómez', 'DEF', 78], ['Balbuena', 'DEF', 75], ['Alderete', 'DEF', 77], ['Espinoza', 'DEF', 74],
    ['Alonso', 'DEF', 73], ['Velázquez', 'DEF', 73],
    ['Villasanti', 'MED', 79], ['Cubas', 'MED', 77], ['Almirón', 'MED', 78],
    ['Enciso', 'MED', 79], ['Bobadilla', 'MED', 74],
    ['Antonio Sanabria', 'DEL', 77], ['Ramón Sosa', 'DEL', 76], ['Bareiro', 'DEL', 73], ['Ovelar', 'DEL', 70],
  ]),

  // ---------- Europa ----------
  squad('ger2026', 'Alemania', 2026, '🇩🇪', 'Die Mannschaft', '#FFFFFF', '#111111', [
    ['Ter Stegen', 'POR', 86], ['Nübel', 'POR', 78],
    ['Kimmich', 'DEF', 86], ['Rüdiger', 'DEF', 85], ['Tah', 'DEF', 82], ['Schlotterbeck', 'DEF', 80],
    ['Mittelstädt', 'DEF', 78], ['Raum', 'DEF', 77], ['Anton', 'DEF', 76],
    ['Wirtz', 'MED', 88], ['Musiala', 'MED', 89], ['Goretzka', 'MED', 80],
    ['Andrich', 'MED', 77], ['Stiller', 'MED', 76],
    ['Havertz', 'DEL', 84], ['Sané', 'DEL', 84], ['Gnabry', 'DEL', 82], ['Füllkrug', 'DEL', 79],
    ['Adeyemi', 'DEL', 78],
  ]),
  squad('ned2026', 'Países Bajos', 2026, '🇳🇱', 'Oranje', '#F36C21', '#FFFFFF', [
    ['Verbruggen', 'POR', 81], ['Flekken', 'POR', 77],
    ['Dumfries', 'DEF', 81], ['Van Dijk', 'DEF', 87], ['De Ligt', 'DEF', 83], ['Aké', 'DEF', 81],
    ['Hato', 'DEF', 78], ['Geertruida', 'DEF', 78], ['Jurriën Timber', 'DEF', 80],
    ['Frenkie de Jong', 'MED', 87], ['Reijnders', 'MED', 83], ['Gravenberch', 'MED', 82],
    ['Schouten', 'MED', 78], ['Veerman', 'MED', 77],
    ['Gakpo', 'DEL', 84], ['Xavi Simons', 'DEL', 84], ['Depay', 'DEL', 81], ['Malen', 'DEL', 79],
    ['Brobbey', 'DEL', 77],
  ]),
  squad('cro2026', 'Croacia', 2026, '🇭🇷', 'Vatreni', '#D52B1E', '#FFFFFF', [
    ['Livaković', 'POR', 83], ['Ivušić', 'POR', 74],
    ['Stanišić', 'DEF', 76], ['Gvardiol', 'DEF', 86], ['Šutalo', 'DEF', 76], ['Sosa', 'DEF', 76],
    ['Erlić', 'DEF', 74], ['Juranović', 'DEF', 77],
    ['Modrić', 'MED', 85], ['Kovačić', 'MED', 83], ['Sučić', 'MED', 79],
    ['Baturina', 'MED', 78], ['Pašalić', 'MED', 77],
    ['Perišić', 'DEL', 79], ['Kramarić', 'DEL', 80], ['Budimir', 'DEL', 76], ['Pjaca', 'DEL', 73],
  ]),
  squad('bel2026', 'Bélgica', 2026, '🇧🇪', 'Los Diablos Rojos', '#E30613', '#FFE936', [
    ['Casteels', 'POR', 79], ['Sels', 'POR', 78],
    ['Castagne', 'DEF', 78], ['Faes', 'DEF', 76], ['Debast', 'DEF', 77], ['Theate', 'DEF', 77],
    ['De Cuyper', 'DEF', 76], ['Meunier', 'DEF', 75],
    ['De Bruyne', 'MED', 88], ['Tielemans', 'MED', 81], ['Onana', 'MED', 80],
    ['Vermeeren', 'MED', 77], ['Mangala', 'MED', 76],
    ['Lukaku', 'DEL', 83], ['Doku', 'DEL', 83], ['Trossard', 'DEL', 81], ['Openda', 'DEL', 81],
    ['Bakayoko', 'DEL', 76],
  ]),
  squad('cze2026', 'Chequia', 2026, '🇨🇿', 'Národní tým', '#D7141A', '#FFFFFF', [
    ['Staněk', 'POR', 76], ['Jaroš', 'POR', 73],
    ['Coufal', 'DEF', 76], ['Hranáč', 'DEF', 75], ['Krejčí', 'DEF', 77], ['Zelený', 'DEF', 73],
    ['Holeš', 'DEF', 76], ['Vitík', 'DEF', 73],
    ['Souček', 'MED', 80], ['Provod', 'MED', 78], ['Šulc', 'MED', 77],
    ['Černý', 'MED', 77], ['Sadílek', 'MED', 74],
    ['Schick', 'DEL', 82], ['Hložek', 'DEL', 78], ['Kušej', 'DEL', 73], ['Chytil', 'DEL', 73],
  ]),
  squad('sui2026', 'Suiza', 2026, '🇨🇭', 'La Nati', '#D52B1E', '#FFFFFF', [
    ['Sommer', 'POR', 82], ['Kobel', 'POR', 81],
    ['Widmer', 'DEF', 75], ['Akanji', 'DEF', 84], ['Schär', 'DEF', 80], ['Rodríguez', 'DEF', 76],
    ['Elvedi', 'DEF', 77], ['Aebischer', 'DEF', 76],
    ['Xhaka', 'MED', 83], ['Freuler', 'MED', 78], ['Rieder', 'MED', 77],
    ['Vargas', 'MED', 77], ['Sow', 'MED', 75],
    ['Embolo', 'DEL', 80], ['Ndoye', 'DEL', 78], ['Shaqiri', 'DEL', 78], ['Amdouni', 'DEL', 76],
    ['Okafor', 'DEL', 77],
  ]),
  squad('tur2026', 'Türkiye', 2026, '🇹🇷', 'Ay-Yıldızlılar', '#E30A17', '#FFFFFF', [
    ['Çakır', 'POR', 80], ['Bayındır', 'POR', 76],
    ['Çelik', 'DEF', 76], ['Demiral', 'DEF', 80], ['Bardakcı', 'DEF', 76], ['Müldür', 'DEF', 75],
    ['Akaydın', 'DEF', 74], ['Kadıoğlu', 'DEF', 78],
    ['Çalhanoğlu', 'MED', 85], ['Kökçü', 'MED', 82], ['Arda Güler', 'MED', 82],
    ['İsmail Yüksek', 'MED', 75], ['Ayhan', 'MED', 74],
    ['Kenan Yıldız', 'DEL', 82], ['Akgün', 'DEL', 78], ['Aktürkoğlu', 'DEL', 78], ['Ünder', 'DEL', 76],
  ]),
  squad('aut2026', 'Austria', 2026, '🇦🇹', 'Das Team', '#ED2939', '#FFFFFF', [
    ['Pentz', 'POR', 75], ['Schlager', 'POR', 74],
    ['Posch', 'DEF', 76], ['Danso', 'DEF', 78], ['Lienhart', 'DEF', 76], ['Mwene', 'DEF', 74],
    ['Wöber', 'DEF', 76], ['Trauner', 'DEF', 75],
    ['Laimer', 'MED', 79], ['Seiwald', 'MED', 77], ['Xaver Schlager', 'MED', 78],
    ['Sabitzer', 'MED', 81], ['Baumgartner', 'MED', 79],
    ['Arnautović', 'DEL', 77], ['Gregoritsch', 'DEL', 76], ['Adamu', 'DEL', 73], ['Wimmer', 'DEL', 74],
  ]),
  squad('swe2026', 'Suecia', 2026, '🇸🇪', 'Blågult', '#006AA7', '#FECC00', [
    ['Robin Olsen', 'POR', 77], ['Nordfeldt', 'POR', 72],
    ['Krafth', 'DEF', 74], ['Lindelöf', 'DEF', 80], ['Hien', 'DEF', 78], ['Augustinsson', 'DEF', 74],
    ['Starfelt', 'DEF', 75], ['Gabriel Gudmundsson', 'DEF', 74],
    ['Olsson', 'MED', 75], ['Saletros', 'MED', 72], ['Ekdal', 'MED', 73],
    ['Bénie', 'MED', 73], ['Svensson', 'MED', 74],
    ['Isak', 'DEL', 87], ['Gyökeres', 'DEL', 86], ['Elanga', 'DEL', 79], ['Bernhardsson', 'DEL', 73],
  ]),
  squad('nor2026', 'Noruega', 2026, '🇳🇴', 'Løvene', '#BA0C2F', '#00205B', [
    ['Nyland', 'POR', 76], ['Dyngeland', 'POR', 71],
    ['Ryerson', 'DEF', 75], ['Ajer', 'DEF', 78], ['Østigård', 'DEF', 77], ['Bjørkan', 'DEF', 73],
    ['Møller Wolfe', 'DEF', 72], ['Heggem', 'DEF', 73],
    ['Ødegaard', 'MED', 87], ['Berge', 'MED', 78], ['Aursnes', 'MED', 78],
    ['Thorsby', 'MED', 74], ['Bobb', 'MED', 76],
    ['Haaland', 'DEL', 93], ['Sørloth', 'DEL', 81], ['Nusa', 'DEL', 79], ['Strand Larsen', 'DEL', 77],
  ]),
  squad('sco2026', 'Escocia', 2026, '🏴', 'The Tartan Army', '#0065BF', '#FFFFFF', [
    ['Gunn', 'POR', 75], ['Clark', 'POR', 71],
    ['Hickey', 'DEF', 75], ['Tierney', 'DEF', 77], ['Hendry', 'DEF', 74], ['Robertson', 'DEF', 81],
    ['Ralston', 'DEF', 72], ['Souttar', 'DEF', 75], ['McKenna', 'DEF', 74],
    ['McTominay', 'MED', 82], ['McGinn', 'MED', 79], ['Gilmour', 'MED', 77],
    ['Christie', 'MED', 74], ['Ferguson', 'MED', 73],
    ['Adams', 'DEL', 74], ['Dykes', 'DEL', 72], ['Shankland', 'DEL', 73], ['Doak', 'DEL', 75],
  ]),
  squad('bos2026', 'Bosnia', 2026, '🇧🇦', 'Zmajevi', '#002395', '#FECB00', [
    ['Vasilj', 'POR', 74], ['Šehić', 'POR', 71],
    ['Kolašinac', 'DEF', 76], ['Ahmedhodžić', 'DEF', 76], ['Bičakčić', 'DEF', 73], ['Katić', 'DEF', 73],
    ['Mujakić', 'DEF', 72], ['Gazibegović', 'DEF', 72],
    ['Pjanić', 'MED', 78], ['Krunić', 'MED', 75], ['Tahirović', 'MED', 73],
    ['Hadžiahmetović', 'MED', 72], ['Bajraktarević', 'MED', 73],
    ['Džeko', 'DEL', 78], ['Demirović', 'DEL', 77], ['Prevljak', 'DEL', 72], ['Hodžić', 'DEL', 71],
  ]),

  // ---------- África ----------
  squad('mar2026', 'Marruecos', 2026, '🇲🇦', 'Los Leones del Atlas', '#C1272D', '#006233', [
    ['Bono', 'POR', 82], ['Munir', 'POR', 75],
    ['Hakimi', 'DEF', 86], ['Aguerd', 'DEF', 79], ['Mazraoui', 'DEF', 80], ['Saïss', 'DEF', 76],
    ['El Yamiq', 'DEF', 74], ['Attiat-Allah', 'DEF', 73],
    ['Amrabat', 'MED', 79], ['Ounahi', 'MED', 78], ['El Khannouss', 'MED', 79],
    ['Amallah', 'MED', 74], ['Ezzalzouli', 'MED', 77],
    ['Brahim Díaz', 'DEL', 82], ['En-Nesyri', 'DEL', 80], ['Ziyech', 'DEL', 80], ['Igamane', 'DEL', 75],
  ]),
  squad('sen2026', 'Senegal', 2026, '🇸🇳', 'Los Leones de Teranga', '#00853F', '#FDEF42', [
    ['Édouard Mendy', 'POR', 80], ['Seny Dieng', 'POR', 74],
    ['Koulibaly', 'DEF', 82], ['Abdou Diallo', 'DEF', 76], ['Niakhaté', 'DEF', 76], ['Jakobs', 'DEF', 74],
    ['Sabaly', 'DEF', 75], ['Krépin Diatta', 'DEF', 76],
    ['Pape Matar Sarr', 'MED', 80], ['Idrissa Gueye', 'MED', 78], ['Pape Gueye', 'MED', 76],
    ['Lamine Camara', 'MED', 77], ['Loum Ndiaye', 'MED', 73],
    ['Sadio Mané', 'DEL', 84], ['Nicolas Jackson', 'DEL', 81], ['Ismaïla Sarr', 'DEL', 80],
    ['Boulaye Dia', 'DEL', 78], ['Habib Diallo', 'DEL', 74],
  ]),
  squad('egy2026', 'Egipto', 2026, '🇪🇬', 'Los Faraones', '#CE1126', '#FFFFFF', [
    ['El Shenawy', 'POR', 78], ['Abou Gabal', 'POR', 73],
    ['Hegazi', 'DEF', 75], ['Abdelmonem', 'DEF', 75], ['Mohamed Hany', 'DEF', 73], ['Fattouh', 'DEF', 73],
    ['Rami Rabia', 'DEF', 72], ['Ahmed Hany', 'DEF', 71],
    ['Elneny', 'MED', 76], ['Emam Ashour', 'MED', 78], ['Zizo', 'MED', 77],
    ['Hamdy Fathy', 'MED', 74], ['Trezeguet', 'MED', 77],
    ['Mohamed Salah', 'DEL', 90], ['Marmoush', 'DEL', 83], ['Mostafa Mohamed', 'DEL', 76], ['Saleh Gomaa', 'DEL', 72],
  ]),
  squad('alg2026', 'Argelia', 2026, '🇩🇿', 'Los Fennecs', '#007229', '#FFFFFF', [
    ['Mandrea', 'POR', 73], ['Oukidja', 'POR', 73],
    ['Mandi', 'DEF', 76], ['Bensebaini', 'DEF', 79], ['Aït Nouri', 'DEF', 80], ['Tougaï', 'DEF', 74],
    ['Bedrane', 'DEF', 73], ['Atal', 'DEF', 75],
    ['Bennacer', 'MED', 81], ['Zerrouki', 'MED', 76], ['Chaïbi', 'MED', 76],
    ['Aouar', 'MED', 78], ['Belaïli', 'MED', 77],
    ['Mahrez', 'DEL', 83], ['Amoura', 'DEL', 80], ['Gouiri', 'DEL', 80], ['Bounedjah', 'DEL', 74],
  ]),
  squad('tun2026', 'Túnez', 2026, '🇹🇳', 'Las Águilas de Cartago', '#E70013', '#FFFFFF', [
    ['Dahmen', 'POR', 75], ['Ben Saïd', 'POR', 72],
    ['Talbi', 'DEF', 75], ['Bronn', 'DEF', 74], ['Meriah', 'DEF', 73], ['Abdi', 'DEF', 72],
    ['Kechrida', 'DEF', 72], ['Maâloul', 'DEF', 72],
    ['Laïdouni', 'MED', 77], ['Ben Romdhane', 'MED', 76], ['Skhiri', 'MED', 78],
    ['Mejbri', 'MED', 75], ['Sassi', 'MED', 73],
    ['Msakni', 'DEL', 76], ['Khazri', 'DEL', 74], ['Jebali', 'DEL', 73], ['Ben Slimane', 'DEL', 72],
  ]),
  squad('gha2026', 'Ghana', 2026, '🇬🇭', 'Las Estrellas Negras', '#CE1126', '#FCD116', [
    ['Ati-Zigi', 'POR', 75], ['Wollacott', 'POR', 72],
    ['Lamptey', 'DEF', 75], ['Salisu', 'DEF', 78], ['Djiku', 'DEF', 76], ['Gideon Mensah', 'DEF', 73],
    ['Aidoo', 'DEF', 73], ['Seidu', 'DEF', 72],
    ['Thomas Partey', 'MED', 82], ['Abdul Samed', 'MED', 74], ['Ashimeru', 'MED', 74],
    ['Kudus', 'MED', 84], ['Issah', 'MED', 72],
    ['Iñaki Williams', 'DEL', 79], ['Semenyo', 'DEL', 79], ['Jordan Ayew', 'DEL', 77],
    ['Sulemana', 'DEL', 77], ['Fatawu', 'DEL', 75],
  ]),
  squad('civ2026', 'Costa de Marfil', 2026, '🇨🇮', 'Los Elefantes', '#FF8200', '#FFFFFF', [
    ['Yahia Fofana', 'POR', 74], ['Badra Ali', 'POR', 71],
    ['Singo', 'DEF', 80], ['Ndicka', 'DEF', 79], ['Kossounou', 'DEF', 78], ['Konan', 'DEF', 73],
    ['Agbadou', 'DEF', 74], ['Aurier', 'DEF', 74],
    ['Kessié', 'MED', 81], ['Sangaré', 'MED', 80], ['Seko Fofana', 'MED', 78],
    ['Seri', 'MED', 73], ['Asamoah', 'MED', 72],
    ['Sébastien Haller', 'DEL', 78], ['Amad Diallo', 'DEL', 80], ['Adingra', 'DEL', 78],
    ['Pépé', 'DEL', 77], ['Krasso', 'DEL', 73],
  ]),
  squad('cod2026', 'Congo DR', 2026, '🇨🇩', 'Los Leopardos', '#007FFF', '#F7D618', [
    ['Mpasi', 'POR', 72], ['Lionga', 'POR', 70],
    ['Mbemba', 'DEF', 78], ['Masuaku', 'DEF', 74], ['Tuanzebe', 'DEF', 73], ['Batubinsika', 'DEF', 73],
    ['Joris Kayembe', 'DEF', 73], ['Bushiri', 'DEF', 72],
    ['Edo Kayembe', 'MED', 75], ['Pickel', 'MED', 74], ['Moutoussamy', 'MED', 74],
    ['Tshibola', 'MED', 72], ['Mukau', 'MED', 73],
    ['Wissa', 'DEL', 80], ['Bakambu', 'DEL', 76], ['Silas', 'DEL', 77], ['Mayele', 'DEL', 75],
    ['Meschack Elia', 'DEL', 74],
  ]),
  squad('rsa2026', 'Sudáfrica', 2026, '🇿🇦', 'Bafana Bafana', '#007A4D', '#FFB81C', [
    ['Ronwen Williams', 'POR', 76], ['Sipho Chaine', 'POR', 71],
    ['Modiba', 'DEF', 73], ['Mvala', 'DEF', 73], ['Mudau', 'DEF', 74], ['Ngezana', 'DEF', 73],
    ['Sithole', 'DEF', 72], ['Aubaas', 'DEF', 71],
    ['Mokoena', 'MED', 76], ['Sphephelo Sithole', 'MED', 73], ['Zwane', 'MED', 75],
    ['Mofokeng', 'MED', 74], ['Mbatha', 'MED', 72],
    ['Lyle Foster', 'DEL', 76], ['Percy Tau', 'DEL', 75], ['Hlongwane', 'DEL', 74], ['Rayners', 'DEL', 73],
  ]),
  squad('cpv2026', 'Cabo Verde', 2026, '🇨🇻', 'Los Tiburones Azules', '#003893', '#FFFFFF', [
    ['Vozinha', 'POR', 72], ['Marcio Rosa', 'POR', 69],
    ['Diney', 'DEF', 72], ['Roberto Lopes', 'DEF', 74], ['Logan Costa', 'DEF', 76], ['Stopira', 'DEF', 72],
    ['Kenny Rocha', 'DEF', 72], ['Sidny Lopes', 'DEF', 71],
    ['Kevin Pina', 'MED', 73], ['Deroy Duarte', 'MED', 73], ['Laros Duarte', 'MED', 73],
    ['Pico', 'MED', 72], ['Jamiro Monteiro', 'MED', 74],
    ['Garry Rodrigues', 'DEL', 75], ['Bebé', 'DEL', 74], ['Ryan Mendes', 'DEL', 73],
    ['Jovane Cabral', 'DEL', 75], ['Willy Semedo', 'DEL', 71],
  ]),

  // ---------- Asia ----------
  squad('jpn2026', 'Japón', 2026, '🇯🇵', 'Los Samuráis Azules', '#BC002D', '#FFFFFF', [
    ['Zion Suzuki', 'POR', 77], ['Daniel Schmidt', 'POR', 74],
    ['Tomiyasu', 'DEF', 80], ['Itakura', 'DEF', 79], ['Hiroki Ito', 'DEF', 78], ['Machida', 'DEF', 75],
    ['Sugawara', 'DEF', 75], ['Watanabe', 'DEF', 74],
    ['Wataru Endo', 'MED', 79], ['Morita', 'MED', 78], ['Kamada', 'MED', 80],
    ['Ao Tanaka', 'MED', 76], ['Mitoma', 'MED', 84],
    ['Kubo', 'DEL', 83], ['Doan', 'DEL', 79], ['Daizen Maeda', 'DEL', 77], ['Ayase Ueda', 'DEL', 76],
  ]),
  squad('irn2026', 'Irán', 2026, '🇮🇷', 'Team Melli', '#239F40', '#FFFFFF', [
    ['Beiranvand', 'POR', 76], ['Niazmand', 'POR', 72],
    ['Hajsafi', 'DEF', 73], ['Majid Hosseini', 'DEF', 74], ['Pouraliganji', 'DEF', 73], ['Kanaanizadegan', 'DEF', 74],
    ['Moharrami', 'DEF', 73], ['Rezaeian', 'DEF', 74],
    ['Ezatolahi', 'MED', 75], ['Ali Karimi', 'MED', 74], ['Nourollahi', 'MED', 75],
    ['Ghoddos', 'MED', 75], ['Ghayedi', 'MED', 73],
    ['Taremi', 'DEL', 82], ['Azmoun', 'DEL', 80], ['Jahanbakhsh', 'DEL', 77], ['Gholizadeh', 'DEL', 74],
  ]),
  squad('kor2026', 'Corea del Sur', 2026, '🇰🇷', 'Guerreros Taegeuk', '#CD2E3A', '#0047A0', [
    ['Kim Seung-gyu', 'POR', 75], ['Jo Hyeon-woo', 'POR', 75],
    ['Kim Min-jae', 'DEF', 84], ['Kim Young-gwon', 'DEF', 75], ['Kim Jin-su', 'DEF', 74], ['Lee Ki-je', 'DEF', 73],
    ['Seol Young-woo', 'DEF', 73], ['Cho Yu-min', 'DEF', 73],
    ['Hwang In-beom', 'MED', 78], ['Lee Jae-sung', 'MED', 77], ['Lee Kang-in', 'MED', 81],
    ['Park Yong-woo', 'MED', 73], ['Hong Hyun-seok', 'MED', 74],
    ['Son Heung-min', 'DEL', 85], ['Hwang Hee-chan', 'DEL', 79], ['Cho Gue-sung', 'DEL', 75], ['Bae Jun-ho', 'DEL', 75],
  ]),
  squad('aus2026', 'Australia', 2026, '🇦🇺', 'Socceroos', '#00843D', '#FFCD00', [
    ['Mat Ryan', 'POR', 77], ['Joe Gauci', 'POR', 72],
    ['Behich', 'DEF', 73], ['Souttar', 'DEF', 76], ['Rowles', 'DEF', 74], ['Atkinson', 'DEF', 73],
    ['Degenek', 'DEF', 72], ['Geria', 'DEF', 71],
    ['McGree', 'MED', 75], ['Metcalfe', 'MED', 74], ['Baccus', 'MED', 73],
    ['Hrustic', 'MED', 75], ['O’Neill', 'MED', 73],
    ['Irankunda', 'DEL', 75], ['Yengi', 'DEL', 73], ['Mitch Duke', 'DEL', 73], ['Boyle', 'DEL', 73],
  ]),
  squad('ksa2026', 'Arabia Saudita', 2026, '🇸🇦', 'Los Halcones Verdes', '#006C35', '#FFFFFF', [
    ['Al-Owais', 'POR', 74], ['Al-Rubaie', 'POR', 71],
    ['Al-Boleahi', 'DEF', 72], ['Tambakti', 'DEF', 74], ['Al-Bulaihi', 'DEF', 73], ['Al-Ghanam', 'DEF', 73],
    ['Saud Abdulhamid', 'DEF', 74], ['Al-Amri', 'DEF', 71],
    ['Al-Faraj', 'MED', 73], ['Kanno', 'MED', 73], ['Nasser Al-Dawsari', 'MED', 73],
    ['Al-Najei', 'MED', 73], ['Al-Juwayr', 'MED', 74],
    ['Salem Al-Dawsari', 'DEL', 78], ['Al-Buraikan', 'DEL', 75], ['Al-Shehri', 'DEL', 73], ['Radif', 'DEL', 72],
  ]),
  squad('irq2026', 'Irak', 2026, '🇮🇶', 'Leones de Mesopotamia', '#007A3D', '#FFFFFF', [
    ['Jalal Hassan', 'POR', 71], ['Ahmad Basil', 'POR', 69],
    ['Merchas Doski', 'DEF', 72], ['Rebin Sulaka', 'DEF', 72], ['Akam Hashim', 'DEF', 70], ['Hussein Ali', 'DEF', 71],
    ['Zaid Tahseen', 'DEF', 70], ['Manaf Younis', 'DEF', 70],
    ['Amir Al-Ammari', 'MED', 73], ['Zidane Iqbal', 'MED', 75], ['Bashar Resan', 'MED', 72],
    ['Ibrahim Bayesh', 'MED', 71], ['Youssef Amyn', 'MED', 73],
    ['Aymen Hussein', 'DEL', 73], ['Mohanad Ali', 'DEL', 74], ['Ali Jasim', 'DEL', 73], ['Al-Hamadi', 'DEL', 73],
  ]),
  squad('uzb2026', 'Uzbekistán', 2026, '🇺🇿', 'Los Lobos Blancos', '#1EB53A', '#0099B5', [
    ['Nematov', 'POR', 71], ['Yusupov', 'POR', 70],
    ['Khusanov', 'DEF', 80], ['Ashurmatov', 'DEF', 73], ['Alijonov', 'DEF', 72], ['Sayfiev', 'DEF', 72],
    ['Shaakhmedov', 'DEF', 70], ['Nasrullaev', 'DEF', 71],
    ['Fayzullaev', 'MED', 78], ['Shukurov', 'MED', 73], ['Masharipov', 'MED', 75],
    ['Turgunboev', 'MED', 73], ['Erkinov', 'MED', 72],
    ['Shomurodov', 'DEL', 78], ['Abdixolikov', 'DEL', 73], ['Urunov', 'DEL', 72], ['Sergeev', 'DEL', 72],
  ]),
  squad('jor2026', 'Jordania', 2026, '🇯🇴', 'Los Caballeros', '#CE1126', '#FFFFFF', [
    ['Yazid Abulaila', 'POR', 70], ['Al-Fakhouri', 'POR', 68],
    ['Salem Al-Ajalin', 'DEF', 70], ['Yazan Al-Arab', 'DEF', 71], ['Abdallah Nasib', 'DEF', 70], ['Ihsan Haddad', 'DEF', 70],
    ['Al-Mardi', 'DEF', 70], ['Bara Marei', 'DEF', 69],
    ['Al-Rashdan', 'MED', 72], ['Al-Rawabdeh', 'MED', 72], ['Al-Mawas', 'MED', 73],
    ['Rajaee Ayed', 'MED', 70], ['Noor Hassan', 'MED', 70],
    ['Al-Taamari', 'DEL', 78], ['Al-Naimat', 'DEL', 73], ['Ali Olwan', 'DEL', 73], ['Mousa Suleiman', 'DEL', 70],
  ]),
  squad('qat2026', 'Catar', 2026, '🇶🇦', 'Los Marrón', '#8A1538', '#FFFFFF', [
    ['Barsham', 'POR', 73], ['Al-Sheeb', 'POR', 71],
    ['Pedro Miguel', 'DEF', 73], ['Khoukhi', 'DEF', 73], ['Tarek Salman', 'DEF', 72], ['Homam Ahmed', 'DEF', 72],
    ['Al-Brake', 'DEF', 71], ['Ró-Ró', 'DEF', 72],
    ['Boudiaf', 'MED', 73], ['Al-Haydos', 'MED', 75], ['Hatem', 'MED', 72],
    ['Jassem Gaber', 'MED', 71], ['Mostafa Meshaal', 'MED', 72],
    ['Akram Afif', 'DEL', 79], ['Almoez Ali', 'DEL', 76], ['Abdurisag', 'DEL', 72], ['Alaaeldin', 'DEL', 72],
  ]),

  // ---------- Concacaf ----------
  squad('usa2026', 'Estados Unidos', 2026, '🇺🇸', 'The Stars and Stripes', '#0A3161', '#B31942', [
    ['Matt Turner', 'POR', 77], ['Patrick Schulte', 'POR', 73],
    ['Sergiño Dest', 'DEF', 79], ['Chris Richards', 'DEF', 78], ['Carter-Vickers', 'DEF', 77], ['Antonee Robinson', 'DEF', 80],
    ['Tim Ream', 'DEF', 73], ['Miles Robinson', 'DEF', 74], ['Scally', 'DEF', 74],
    ['Tyler Adams', 'MED', 79], ['Weston McKennie', 'MED', 81], ['Yunus Musah', 'MED', 79],
    ['Johnny Cardoso', 'MED', 77], ['Gio Reyna', 'MED', 78],
    ['Pulisic', 'DEL', 85], ['Balogun', 'DEL', 80], ['Tim Weah', 'DEL', 78], ['Aaronson', 'DEL', 77],
    ['Ricardo Pepi', 'DEL', 77],
  ]),
  squad('mex2026', 'México', 2026, '🇲🇽', 'El Tri', '#006847', '#FFFFFF', [
    ['Luis Malagón', 'POR', 77], ['Rangel', 'POR', 73],
    ['Jorge Sánchez', 'DEF', 74], ['César Montes', 'DEF', 78], ['Johan Vásquez', 'DEF', 78], ['Gallardo', 'DEF', 75],
    ['Israel Reyes', 'DEF', 74], ['Kevin Álvarez', 'DEF', 73], ['Huescas', 'DEF', 73],
    ['Edson Álvarez', 'MED', 81], ['Luis Romo', 'MED', 76], ['Luis Chávez', 'MED', 76],
    ['Orbelín Pineda', 'MED', 77], ['Erik Lira', 'MED', 74],
    ['Santiago Giménez', 'DEL', 81], ['Raúl Jiménez', 'DEL', 78], ['Hirving Lozano', 'DEL', 80],
    ['Alexis Vega', 'DEL', 77], ['Julián Quiñones', 'DEL', 76],
  ]),
  squad('can2026', 'Canadá', 2026, '🇨🇦', 'Les Rouges', '#FF0000', '#FFFFFF', [
    ['Crépeau', 'POR', 74], ['Dayne St. Clair', 'POR', 75],
    ['Alphonso Davies', 'DEF', 85], ['Bombito', 'DEF', 77], ['Cornelius', 'DEF', 74], ['Alistair Johnston', 'DEF', 78],
    ['Kamal Miller', 'DEF', 73], ['Richie Laryea', 'DEF', 73],
    ['Stephen Eustáquio', 'MED', 78], ['Ismaël Koné', 'MED', 76], ['Jonathan Osorio', 'MED', 73],
    ['Choinière', 'MED', 72], ['Liam Fraser', 'MED', 71],
    ['Jonathan David', 'DEL', 83], ['Cyle Larin', 'DEL', 76], ['Tajon Buchanan', 'DEL', 78],
    ['Shaffelburg', 'DEL', 74], ['Promise David', 'DEL', 74],
  ]),
  squad('pan2026', 'Panamá', 2026, '🇵🇦', 'La Marea Roja', '#DA121A', '#005293', [
    ['Orlando Mosquera', 'POR', 73], ['César Samudio', 'POR', 70],
    ['Michael Murillo', 'DEF', 76], ['Fidel Escobar', 'DEF', 73], ['Eric Davis', 'DEF', 73], ['César Blackman', 'DEF', 72],
    ['Edgardo Fariña', 'DEF', 71], ['Jorge Gutiérrez', 'DEF', 71],
    ['Carrasquilla', 'MED', 76], ['Aníbal Godoy', 'MED', 73], ['Cristian Martínez', 'MED', 73],
    ['Andrés Andrade', 'MED', 75], ['Adalberto Carrasquilla', 'MED', 73],
    ['José Fajardo', 'DEL', 73], ['Ismael Díaz', 'DEL', 74], ['Cecilio Waterman', 'DEL', 73], ['Eduardo Guerrero', 'DEL', 72],
  ]),
  squad('cuw2026', 'Curazao', 2026, '🇨🇼', 'Famia Kòrsou', '#002B7F', '#F9E814', [
    ['Eloy Room', 'POR', 73], ['Diquan Adamus', 'POR', 68],
    ['Cuco Martina', 'DEF', 71], ['Shanon Carmelia', 'DEF', 70], ['Roshon van Eijma', 'DEF', 69], ['Rihairo Meulens', 'DEF', 70],
    ['Jarzinho Malanga', 'DEF', 70], ['Armando Obispo', 'DEF', 72],
    ['Leandro Bacuna', 'MED', 73], ['Juninho Bacuna', 'MED', 73], ['Kenji Gorré', 'MED', 71],
    ['Jeremy Antonisse', 'MED', 70], ['Sherel Floranus', 'MED', 70],
    ['Tahith Chong', 'DEL', 75], ['Jürgen Locadia', 'DEL', 73], ['Gervane Kastaneer', 'DEL', 71], ['Sontje Hansen', 'DEL', 73],
  ]),
  squad('hai2026', 'Haití', 2026, '🇭🇹', 'Les Grenadiers', '#00209F', '#D21034', [
    ['Johny Placide', 'POR', 71], ['Josué Duverger', 'POR', 68],
    ['Ricardo Adé', 'DEF', 71], ['Carlens Arcus', 'DEF', 72], ['Jean-Kévin Duverne', 'DEF', 72], ['Andrew Jean-Baptiste', 'DEF', 70],
    ['Garven Metusala', 'DEF', 70], ['Christopher Attys', 'DEF', 70],
    ['Danley Jean Jacques', 'MED', 73], ['Derrick Etienne', 'MED', 74], ['Jems Geffrard', 'MED', 71],
    ['Leverton Pierre', 'MED', 70], ['Wilde-Donald Guerrier', 'MED', 70],
    ['Frantzdy Pierrot', 'DEL', 73], ['Duckens Nazon', 'DEL', 71], ['Ruben Providence', 'DEL', 72], ['Don Deedson Louicius', 'DEL', 71],
  ]),

  // ---------- Oceanía ----------
  squad('nzl2026', 'Nueva Zelanda', 2026, '🇳🇿', 'All Whites', '#FFFFFF', '#000000', [
    ['Max Crocombe', 'POR', 72], ['Alex Paulsen', 'POR', 73],
    ['Tyler Bindon', 'DEF', 74], ['Nando Pijnaker', 'DEF', 72], ['Michael Boxall', 'DEF', 73], ['Liberato Cacace', 'DEF', 75],
    ['Finn Surman', 'DEF', 72], ['Dane Ingham', 'DEF', 71],
    ['Marko Stamenic', 'MED', 74], ['Joe Bell', 'MED', 73], ['Matthew Garbett', 'MED', 72],
    ['Ben Old', 'MED', 73], ['Sarpreet Singh', 'MED', 73],
    ['Chris Wood', 'DEL', 79], ['Ben Waine', 'DEL', 72], ['Eli Just', 'DEL', 71], ['Kosta Barbarouses', 'DEL', 71],
  ]),
];

// todos los planteles (históricos + Mundial 2026) para construir los índices globales
const TODOS_LOS_PLANTELES = [...SQUADS, ...SQUADS_2026];
export const SQUADS_BY_KEY = Object.fromEntries(TODOS_LOS_PLANTELES.map(s => [s.key, s]));

// índice global de jugadores: el once de un DT mezcla jugadores de varios planteles
export const JUGADORES_BY_ID = {};
for (const s of TODOS_LOS_PLANTELES) for (const j of s.jugadores) JUGADORES_BY_ID[j.id] = { ...j, squad: s };

// selecciones disponibles según el modo: "mundial2026" usa SOLO las del Mundial 2026;
// el resto de modos (clásico/almanaque/penales) usan SOLO las históricas
export function squadsParaModo(modo) {
  return modo === 'mundial2026' ? SQUADS_2026 : SQUADS;
}

export const FORMACIONES = {
  '4-4-2': { DEF: 4, MED: 4, DEL: 2 },
  '4-3-3': { DEF: 4, MED: 3, DEL: 3 },
  '4-2-3-1': { DEF: 4, MED: 5, DEL: 1 },
  '3-5-2': { DEF: 3, MED: 5, DEL: 2 },
  '5-3-2': { DEF: 5, MED: 3, DEL: 2 },
  '4-5-1': { DEF: 4, MED: 5, DEL: 1 },
  '3-4-3': { DEF: 3, MED: 4, DEL: 3 },
};

export const FORMACION_SLOTS = {
  '4-4-2': ['POR', 'LI', 'DFC', 'DFC', 'LD', 'MI', 'MC', 'MC', 'MD', 'DC', 'DC'],
  '4-3-3': ['POR', 'LI', 'DFC', 'DFC', 'LD', 'MC', 'MC', 'MC', 'EI', 'DC', 'ED'],
  '4-2-3-1': ['POR', 'LI', 'DFC', 'DFC', 'LD', 'MCD', 'MCD', 'MI', 'MCO', 'MD', 'DC'],
  '3-5-2': ['POR', 'DFC', 'DFC', 'DFC', 'MI', 'MC', 'MCD', 'MC', 'MD', 'DC', 'DC'],
  '5-3-2': ['POR', 'LI', 'DFC', 'DFC', 'DFC', 'LD', 'MC', 'MCD', 'MC', 'DC', 'DC'],
  '4-5-1': ['POR', 'LI', 'DFC', 'DFC', 'LD', 'MI', 'MC', 'MCD', 'MC', 'MD', 'DC'],
  '3-4-3': ['POR', 'DFC', 'DFC', 'DFC', 'MI', 'MC', 'MC', 'MD', 'EI', 'DC', 'ED'],
};
