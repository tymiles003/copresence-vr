var TWEEN = require('tween.js');
var Util = require('./util');

var HEAD_Y = 0.5;
var BREATHING_RATE = 3000;
var EYE_RADIUS = 0.075;
var EYE_SEPARATION = 0.3;
var HEAD_HEIGHT = 0.75;
var HEAD_WIDTH = 1;
var JAW_HEIGHT = 0.25;
var LEG_SEPARATION = 0.5;
var LEG_RADIUS = 0.1;
var LEG_HEIGHT = 0.6;
var MOUTH_HEIGHT = 0.01;
var SCALE_DURATION = 1000;
var WALK_DURATION = 1000;
var WALK_ANGLE = Math.PI/6;
var WALKING_RATE = 600;

var State = {
  NONE: 1,
  IDLE: 2,
  WALKING: 3
};
/**
 * Controller for rendering a single remote peer. Manages the peer model
 * completely, including adding and removing from scene.
 *
 *   Render the other peer in 6DOF.
 *   General pose updates (looking around)
 *   Entering transition
 *   Leaving transition
 *   Idle animation
 *   Walking animation
 *   Shrinking animation
 *   Growing animation
 *   Speaking animation
 *
 *   TODO(smus): Smoothly transition the other peer as they move around the world.
 */
function PeerRenderer(scene, peerId) {
  this.state = State.NONE;

  this.color = this.getColorFromId_(peerId);

  // Create the peer itself.
  var peer = new THREE.Object3D();
  peer.visible = false;

  // Create the legs for this peer.
  var leftLeg = this.createLeg_();
  leftLeg.position.x = LEG_SEPARATION/2;
  var rightLeg = this.createLeg_();
  rightLeg.position.x = -LEG_SEPARATION/2;

  peer.add(leftLeg);
  peer.add(rightLeg);

  // Create the head.
  var head = new THREE.Object3D();
  head.position.y = HEAD_Y;
  peer.add(head);

  // Create the lower jaw.
  var lower = this.createJaw_();
  lower.position.y = -JAW_HEIGHT/2;
  head.add(lower);

  var upper = this.createHead_();
  upper.position.y = HEAD_HEIGHT/2 + MOUTH_HEIGHT;
  head.add(upper);

  // Give the head some eyes.
  var eyeRoot = new THREE.Object3D();
  var leftEye = this.createEye_();
  leftEye.position.x = EYE_SEPARATION/2;
  var rightEye = this.createEye_();
  rightEye.position.x = -EYE_SEPARATION/2;
  eyeRoot.add(leftEye);
  eyeRoot.add(rightEye);
  upper.add(eyeRoot);
  eyeRoot.position.z = -HEAD_WIDTH/2;
  eyeRoot.position.y = -JAW_HEIGHT/2;

  // Add the torso to the scene.
  scene.add(peer);

  // Save important pieces of the model for animation later.
  this.scene = scene;
  this.peer = peer;
  this.head = head;
  this.upper = upper;
  this.eyeRoot = eyeRoot;

  this.leftLeg = leftLeg;
  this.rightLeg = rightLeg;
}

PeerRenderer.prototype.enter = function() {
  var self = this;

  // Fade the peer in.
  var targetScale = this.peer.scale.clone();
  this.peer.scale.set(0, 0, 0);
  var tween = new TWEEN.Tween(this.peer.scale);
  tween.to(targetScale, 1000).easing(TWEEN.Easing.Elastic.InOut).start();
  this.peer.visible = true;

  this.isAnimating = true;
  this.animate_();

  // Start the idle animation.
  this.startIdleAnimation_();
};

PeerRenderer.prototype.leave = function() {
  var self = this;

  // Fade the peer out.
  var targetScale = new THREE.Vector3(0, 0, 0);
  var tween = new TWEEN.Tween(this.peer.scale);
  tween.to(targetScale, 1000).easing(TWEEN.Easing.Elastic.InOut)
  tween.onComplete(function() {
    self.peer.visible = false;
  }).start();

  // Stop the idle animation.
  this.stopIdleAnimation_();

  // Stop animating.
  this.stopAnimating_();
};

PeerRenderer.prototype.setPeerPose = function(peerPose) {
  var self = this;

  if (!this.peer.position.equals(peerPose.position) && !this.targetPosition) {
    this.targetPosition = peerPose.position;
    // Tween the position of the peer.
    var move = new TWEEN.Tween(this.peer.position);
    move.to(this.targetPosition, WALK_DURATION);
    move.onComplete(function() {
      // When done, go into idle mode.
      self.stopWalking_();
      self.targetPosition = null;
    });
    move.start();
    // When starting, go into walking mode.
    this.startWalking_();
  }


  var euler = new THREE.Euler();
  euler.setFromQuaternion(peerPose.quaternion);
  euler.reorder('YXZ');
  // Apply the yaw to the whole body.
  this.peer.rotation.y = euler.y;

  // Apply the pitch and roll to the head.
  this.head.rotation.x = euler.x;
  this.head.rotation.z = euler.z;

  var s = peerPose.scale;
  var targetScale = new THREE.Vector3(s, s, s);
  // Tween the scale, only if the target scale is different, and if we're not
  // already scaling.
  if (!targetScale.equals(this.peer.scale) && !this.targetScale) {
    this.targetScale = targetScale;
    var rescale = new TWEEN.Tween(this.peer.scale);
    rescale.onComplete(function() {
      self.targetScale = null;
    });
    rescale.to(targetScale, SCALE_DURATION).easing(TWEEN.Easing.Back.InOut).start();
  }
};

/**
 * Animate the audio level for this peer.
 * https://musiclab.chromeexperiments.com/Oscillators
 */
PeerRenderer.prototype.setPeerAudioLevel = function(level) {
  if (level !== null) {
    this.speak_();
  }
};

PeerRenderer.prototype.startIdleAnimation_ = function() {
  // Randomly blink sometimes.
  this.state = State.IDLE;
  this.nextBlinkDelta = 3000;
  this.lastBlinkTime = performance.now();
  this.lastBreathTime = performance.now();
};

PeerRenderer.prototype.stopIdleAnimation_ = function() {
  this.state = State.NONE;
};

PeerRenderer.prototype.animate_ = function() {
  var now = performance.now();
  if (this.state == State.IDLE) {
    if (now - this.lastBlinkTime > this.nextBlinkDelta) {
      // Every 3 - 5 seconds, blink.
      this.blink_();
      this.nextBlinkDelta = Util.randInt(500, 5000);
      this.lastBlinkTime = now;
    }

    if (now - this.lastBreathTime > BREATHING_RATE) {
      this.breathe_();
      this.lastBreathTime = now;
    }
  }

  if (this.state == State.WALKING) {
    if (now - this.lastWalkTime > WALKING_RATE) {
      this.walk_();
      this.lastWalkTime = now;
    }
  }

  if (this.isAnimating) {
    requestAnimationFrame(this.animate_.bind(this));
  }
};

PeerRenderer.prototype.stopAnimating_ = function() {
  this.isAnimating = false;
};

PeerRenderer.prototype.blink_ = function() {
  var origScale = this.eyeRoot.scale.clone();
  var targetScale = origScale.clone();
  targetScale.y = 0;

  var close = new TWEEN.Tween(this.eyeRoot.scale);
  close.to(targetScale, 100);

  var open = new TWEEN.Tween(this.eyeRoot.scale);
  open.to(origScale, 100);

  close.chain(open);
  close.start();
};

PeerRenderer.prototype.breathe_ = function() {
  var origScale = this.head.scale.clone();
  var targetScale = origScale.clone();
  targetScale.set(1.02, 1.02, 1.02);

  var breathIn = new TWEEN.Tween(this.head.scale);
  breathIn.to(targetScale, BREATHING_RATE/3);
  breathIn.easing(TWEEN.Easing.Quadratic.In);

  var breathOut = new TWEEN.Tween(this.head.scale);
  breathOut.to(origScale, BREATHING_RATE/3);
  breathOut.easing(TWEEN.Easing.Quadratic.In);

  breathIn.chain(breathOut);
  breathIn.start();
};

PeerRenderer.prototype.walk_ = function() {
  // Rotate the left leg forward while rotating the right leg back.
  var leftForward = new TWEEN.Tween(this.leftLeg.rotation);
  leftForward.to({x: WALK_ANGLE}, WALKING_RATE/2);
  var leftBack = new TWEEN.Tween(this.leftLeg.rotation);
  leftBack.to({x: -WALK_ANGLE}, WALKING_RATE/2);

  var rightBack = new TWEEN.Tween(this.rightLeg.rotation);
  rightBack.to({x: -WALK_ANGLE}, WALKING_RATE/2);
  var rightForward = new TWEEN.Tween(this.rightLeg.rotation);
  rightForward.to({x: WALK_ANGLE}, WALKING_RATE/2);

  leftForward.chain(leftBack).start();
  rightBack.chain(rightForward).start();
};

PeerRenderer.prototype.speak_ = function() {
  // Don't speak again if already speaking.
  if (this.isSpeaking) {
    return;
  }

  var self = this;

  // Tween the upper part of the head, Southpark style.
  var originalPosition = this.upper.position.clone();
  var targetPosition = originalPosition.clone();
  targetPosition.y += 0.1;

  var up = new TWEEN.Tween(this.upper.position);
  up.to(targetPosition, 100);

  var down = new TWEEN.Tween(this.upper.position);
  down.to(originalPosition, 100);

  down.onComplete(function(e) {
    self.isSpeaking = false;
  });

  up.chain(down);
  up.start();
  self.isSpeaking = true;
};

PeerRenderer.prototype.startWalking_ = function() {
  this.stopIdleAnimation_();
  this.lastWalkTime = performance.now() - WALKING_RATE;
  this.state = State.WALKING;
};

PeerRenderer.prototype.stopWalking_ = function() {
  var leftBack = new TWEEN.Tween(this.leftLeg.rotation);
  leftBack.to({x: 0}, WALKING_RATE/2).start();

  var rightBack = new TWEEN.Tween(this.rightLeg.rotation);
  rightBack.to({x: 0}, WALKING_RATE/2).start();

  this.startIdleAnimation_();
};

PeerRenderer.prototype.createEye_ = function() {
  var geometry = new THREE.SphereGeometry(EYE_RADIUS, 32, 32);
  var material = new THREE.MeshBasicMaterial({color: 0x000000});
  var eye = new THREE.Mesh(geometry, material);
  return eye;
};

PeerRenderer.prototype.createLeg_ = function() {
  var geometry = new THREE.CylinderGeometry(LEG_RADIUS, LEG_RADIUS, LEG_HEIGHT)
  var material = new THREE.MeshStandardMaterial({color: 0x000000});
  var leg = new THREE.Mesh(geometry, material);
  return leg;
};

PeerRenderer.prototype.createHead_ = function() {
  var geometry = new THREE.BoxGeometry(HEAD_WIDTH, HEAD_HEIGHT, HEAD_WIDTH);
  var material = new THREE.MeshStandardMaterial({color: this.color});
  var head = new THREE.Mesh(geometry, material);
  return head;
};

PeerRenderer.prototype.createJaw_ = function() {
  var geometry = new THREE.BoxGeometry(HEAD_WIDTH, JAW_HEIGHT, HEAD_WIDTH);
  var material = new THREE.MeshStandardMaterial({color: this.color});
  var jaw = new THREE.Mesh(geometry, material);
  return jaw;
};

// From http://goo.gl/IWRfBX
PeerRenderer.prototype.getColorFromId_ = function(id) {
  function componentToHex(component) {
    return ('0' + component.toString(16)).substr(-2);
  }
  var hash = Util.getHashCode(id);
  var r = (hash & 0xFF0000) >> 16;
  var g = (hash & 0x00FF00) >> 8;
  var b = hash & 0x0000FF;
  return '#' + componentToHex(r) + componentToHex(g) + componentToHex(b);
};

module.exports = PeerRenderer;
