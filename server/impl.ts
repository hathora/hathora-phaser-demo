import { ArcadePhysics } from "arcade-physics";
import { Body } from "arcade-physics/lib/physics/arcade/Body";
import { Response } from "../api/base";
import {
  PlayerState,
  UserId,
  ISetInputsRequest,
  Inputs,
  IFreezeRequest,
  XDirection,
  YDirection,
  Star,
} from "../api/types";
import { Methods, Context } from "./.hathora/methods";
import { MAP_HEIGHT, MAP_WIDTH, PLATFORM_HEIGHT, PLAYER_HEIGHT, PLAYER_WIDTH } from "../shared/constants";
import { BORDER_RADIUS, generatePlatforms } from "./map";

type InternalPlayer = {
  id: UserId;
  body: Body;
  inputs: Inputs;
  freezeTimer: number;
};
type InternalPlatform = {
  body: Body;
  createdBy?: UserId;
};
type InternalState = {
  physics: ArcadePhysics;
  platforms: InternalPlatform[];
  players: InternalPlayer[];
  star: Body;
  startTime: number;
  finishTime?: number;
};

export class Impl implements Methods<InternalState> {
  initialize(ctx: Context): InternalState {
    const config = {
      sys: {
        game: { config: {} },
        settings: { physics: { gravity: { y: 200 } } },
        scale: { width: MAP_WIDTH, height: MAP_HEIGHT },
      },
    };
    const physics = new ArcadePhysics(config);
    const platforms = generatePlatforms(MAP_WIDTH, MAP_HEIGHT, ctx.chance);
    return {
      physics,
      platforms: platforms.map(({ x, y, width }) => {
        return { body: makeStaticBody(physics, x, y, width, PLATFORM_HEIGHT) };
      }),
      players: [],
      star: makeStaticBody(physics, ctx.chance.natural({ max: MAP_WIDTH }), 0, PLAYER_WIDTH, PLAYER_HEIGHT),
      startTime: ctx.time,
    };
  }
  joinGame(state: InternalState, userId: string, ctx: Context): Response {
    if (state.players.find((player) => player.id === userId) !== undefined) {
      return Response.error("Already joined");
    }
    const playerBody = state.physics.add.body(
      ctx.chance.natural({ max: MAP_WIDTH }),
      MAP_HEIGHT - BORDER_RADIUS,
      PLAYER_WIDTH,
      PLAYER_HEIGHT
    );
    playerBody.pushable = false;
    // @ts-ignore
    playerBody.setCollideWorldBounds(true);
    state.platforms.forEach((platform) => state.physics.add.collider(playerBody, platform.body));
    state.players.forEach((player) => state.physics.add.collider(playerBody, player.body));
    state.players.push({
      id: userId,
      body: playerBody,
      inputs: { horizontal: XDirection.NONE, vertical: YDirection.NONE },
      freezeTimer: 0,
    });
    return Response.ok();
  }
  setInputs(state: InternalState, userId: UserId, ctx: Context, request: ISetInputsRequest): Response {
    const player = state.players.find((p) => p.id === userId);
    if (player === undefined) {
      return Response.error("Player not joined");
    }
    player.inputs = request.inputs;
    return Response.ok();
  }
  freeze(state: InternalState, userId: string, ctx: Context, request: IFreezeRequest): Response {
    const player = state.players.find((p) => p.id === userId);
    if (player === undefined) {
      return Response.error("Player not joined");
    }
    if (player.freezeTimer > 0) {
      return Response.error("Frozen");
    }
    if (player.body.y < BORDER_RADIUS || player.body.y > MAP_HEIGHT - BORDER_RADIUS) {
      return Response.error("Too close to border");
    }
    if (state.finishTime !== undefined) {
      return Response.error("Game is over");
    }

    const platformBody = makeStaticBody(state.physics, player.body.x, player.body.y, PLAYER_WIDTH, PLATFORM_HEIGHT);
    state.platforms.push({ body: platformBody, createdBy: userId });
    state.players.forEach((p) => state.physics.add.collider(p.body, platformBody));

    player.body.moves = false;
    player.freezeTimer = 5;
    ctx.sendEvent("frozen", userId);
    return Response.ok();
  }
  getUserState(state: InternalState, userId: UserId): PlayerState {
    return {
      players: state.players.map(({ id, body }) => ({ id, x: body.x, y: body.y })),
      platforms: state.platforms.map((platform) => ({
        x: platform.body.x,
        y: platform.body.y,
        width: platform.body.width,
        createdBy: platform.createdBy,
      })),
      star: { x: state.star.x, y: state.star.y },
      startTime: state.startTime,
      finishTime: state.finishTime,
    };
  }
  onTick(state: InternalState, ctx: Context, timeDelta: number): void {
    state.players.forEach((player) => {
      if (player.inputs.horizontal === XDirection.LEFT && !player.body.blocked.left) {
        player.body.setVelocityX(-200);
      } else if (player.inputs.horizontal === XDirection.RIGHT && !player.body.blocked.right) {
        player.body.setVelocityX(200);
      } else if (player.inputs.horizontal === XDirection.NONE) {
        player.body.setVelocityX(0);
      }
      if (player.inputs.vertical === YDirection.UP && player.body.blocked.down) {
        player.body.setVelocityY(-200);
        ctx.sendEvent("jump", player.id);
      } else if (player.inputs.vertical === YDirection.DOWN && !player.body.blocked.down) {
        player.body.setVelocityY(150);
      }

      if (player.freezeTimer > 0) {
        player.freezeTimer -= timeDelta;
        if (player.freezeTimer < 0) {
          player.freezeTimer = 0;
          player.body.moves = true;
          player.body.x = ctx.chance.natural({ max: MAP_WIDTH });
          player.body.y = MAP_HEIGHT - BORDER_RADIUS;
          ctx.sendEvent("respawn", player.id);
        }
      }

      if (state.finishTime === undefined) {
        //@ts-ignore
        if (state.physics.overlap(player.body, state.star)) {
          state.finishTime = ctx.time;
        }
      }
    });

    if (!state.players.every(({ body }) => body.velocity.x === 0 && body.velocity.y === 0 && body.blocked.down)) {
      state.physics.world.update(ctx.time, timeDelta * 1000);
    }
  }
}

function makeStaticBody(physics: ArcadePhysics, x: number, y: number, width: number, height: number) {
  const body = physics.add.body(Math.round(x), Math.round(y), width, height);
  body.allowGravity = false;
  body.pushable = false;
  return body;
}
