// Demonstrate an ordinary tactical mistake through player commands, not damage
// injection. Both heroes cover the left side; the player can still intervene.
export function startExposedLaneDemo(commands) {
  commands.newGame();
  commands.travel('meadow');
  const heroes = commands.heroes();
  if (heroes.length < 2) throw new Error('The opening party needs two heroes');
  commands.move(heroes[0].id, 2);
  commands.move(heroes[1].id, 4);
  commands.doubleSpeed();
  commands.startWave();
}
