# OSCAR: the TouchDesigner Parameter Rack's demo patch.
#
# This builds, inside TouchDesigner, the network the "TouchDesigner Parameter
# Rack" template talks to: a generative picture driven by the rack's faders,
# pad, colour and scene keys, and the two readings the rack's meters show --
# an audio level from the microphone and a (simulated) sensor.
#
# To use it:
#   1. Run OSCAR, open the Parameter Rack template, and open it on a phone.
#   2. Drag this file into TouchDesigner's network editor. It becomes a Text DAT.
#   3. Right-click that DAT and choose "Run Script". A Base COMP called
#      oscar_demo appears, with the picture on its output.
#
# If TouchDesigner is not on the same computer as OSCAR, change the two lines
# under "Where OSCAR is" first. OSCAR prints its IP and listening port when it
# starts; the port is 9000 unless you changed it (the top bar says which).
#
# What is built:
#   oscin      OSC In CHOP, port 10000: everything the rack sends.
#   lib        a Text DAT with one helper, ch(), which reads a rack channel by
#              its OSC address and gives a default until the first message.
#   picture    Noise TOP -> HSV Adjust -> Feedback, driven by the four faders;
#              a Circle TOP at the pad's position in the colour picker's colour;
#              the three scene keys pick the noise type.
#   audio      Audio Device In -> Analyze (RMS) -> Lag -> Math: 0 to 1.
#   sensor     an LFO standing in for a sensor. Replace it with yours.
#   oscout     OSC Out CHOP to OSCAR: /td/audio/level and /td/sensor/distance,
#              which the rack's two meters follow.

# ---- Where OSCAR is ------------------------------------------------------------
OSCAR_IP = '127.0.0.1'
OSCAR_PORT = 9000

# ---- the helper the picture's expressions use ----------------------------------
LIB = '''
def ch(name, default=0.0, index=0):
    """A channel the rack sent, by its OSC address without the slash, or the
    default until it has. A message with several values (the pad's x y, the
    colour's r g b) makes several channels; index picks one, in order."""
    o = op('oscin')
    if o is None:
        return default
    key = name.replace('/', '')
    found = sorted(c for c in o.chans() if c.name.replace('/', '').replace(':', '').startswith(key)
                   and not c.name.replace('/', '').replace(':', '')[len(key):].strip('0123456789'))
    if index < len(found):
        return found[index][0]
    return default
'''

# ---- build ---------------------------------------------------------------------
home = me.parent() if hasattr(me, 'parent') else op('/project1')
old = home.op('oscar_demo')
if old:
    old.destroy()
demo = home.create(baseCOMP, 'oscar_demo')
demo.nodeX, demo.nodeY = 0, 0
demo.viewer = True

lib = demo.create(textDAT, 'lib')
lib.text = LIB
lib.nodeX, lib.nodeY = -800, 400

oscin = demo.create(oscinCHOP, 'oscin')
oscin.par.port = 10000
oscin.nodeX, oscin.nodeY = -800, 200

# The picture: noise, coloured, fed back, with a circle at the pad's position.
noise = demo.create(noiseTOP, 'noise')
noise.par.resolutionw, noise.par.resolutionh = 1280, 720
noise.par.mono = False
noise.par.period.expr = "0.2 + 2.0 * mod('lib').ch('td/scale', 0.5)"
noise.par.tz.expr = "absTime.seconds * mod('lib').ch('td/speed', 1.0)"
noise.par.type.expr = ("'random' if mod('lib').ch('td/scene/3', 0) > 0.5 else "
                       "'alligator' if mod('lib').ch('td/scene/2', 0) > 0.5 else 'sparse'")
noise.nodeX, noise.nodeY = -600, 0

hsv = demo.create(hsvadjustTOP, 'colour')
hsv.par.hueoffset.expr = "360 * mod('lib').ch('td/hue', 0.2)"
hsv.par.saturationmult = 1.4
hsv.nodeX, hsv.nodeY = -400, 0
noise.outputConnectors[0].connect(hsv)

circle = demo.create(circleTOP, 'circle')
circle.par.resolutionw, circle.par.resolutionh = 1280, 720
circle.par.radiusx = circle.par.radiusy = 0.12
circle.par.centerx.expr = "mod('lib').ch('td/position', 0.0, 0) * 0.5"
circle.par.centery.expr = "mod('lib').ch('td/position', 0.0, 1) * 0.5"
circle.par.fillcolorr.expr = "mod('lib').ch('td/colour', 0.2, 0)"
circle.par.fillcolorg.expr = "mod('lib').ch('td/colour', 0.8, 1)"
circle.par.fillcolorb.expr = "mod('lib').ch('td/colour', 1.0, 2)"
circle.par.softness = 0.02
circle.nodeX, circle.nodeY = -400, -200

over = demo.create(overTOP, 'over')
over.nodeX, over.nodeY = -200, 0
circle.outputConnectors[0].connect(over.inputConnectors[0])
hsv.outputConnectors[0].connect(over.inputConnectors[1])

feedback = demo.create(feedbackTOP, 'feedback')
feedback.nodeX, feedback.nodeY = 0, 0
level = demo.create(levelTOP, 'fade')
level.par.opacity.expr = "mod('lib').ch('td/feedback', 0.65)"
level.nodeX, level.nodeY = 200, 0
mix = demo.create(overTOP, 'mix')
mix.nodeX, mix.nodeY = 400, 0
over.outputConnectors[0].connect(mix.inputConnectors[0])
feedback.outputConnectors[0].connect(level)
level.outputConnectors[0].connect(mix.inputConnectors[1])
feedback.par.top = mix
over.outputConnectors[0].connect(feedback)

out = demo.create(outTOP, 'out1')
out.nodeX, out.nodeY = 600, 0
mix.outputConnectors[0].connect(out)

# The audio level: the microphone's loudness, 0 to 1.
mic = demo.create(audiodeviceinCHOP, 'mic')
mic.nodeX, mic.nodeY = -800, -400
analyze = demo.create(analyzeCHOP, 'loudness')
rms = [m for m in analyze.par.function.menuNames if 'rms' in m.lower()]
if rms:
    analyze.par.function = rms[0]
analyze.nodeX, analyze.nodeY = -600, -400
mic.outputConnectors[0].connect(analyze)
lag = demo.create(lagCHOP, 'smooth')
lag.par.lag1 = 0.05
lag.par.lag2 = 0.25
lag.nodeX, lag.nodeY = -400, -400
analyze.outputConnectors[0].connect(lag)
gain = demo.create(mathCHOP, 'gain')
gain.par.gain = 6
gain.par.tolow, gain.par.tohigh = 0, 1
gain.par.torange = True
gain.nodeX, gain.nodeY = -200, -400
lag.outputConnectors[0].connect(gain)
audio = demo.create(renameCHOP, 'audio')
audio.par.renamefrom = '*'
audio.par.renameto = 'td/audio/level'
audio.nodeX, audio.nodeY = 0, -400
gain.outputConnectors[0].connect(audio)

# The sensor: a slow wave standing in for one. Put your own CHOP here.
lfo = demo.create(lfoCHOP, 'sensor_stand_in')
lfo.par.frequency = 0.1
lfo.par.amplitude = 0.5
lfo.par.offset = 0.5
lfo.nodeX, lfo.nodeY = -800, -600
sensor = demo.create(renameCHOP, 'sensor')
sensor.par.renamefrom = '*'
sensor.par.renameto = 'td/sensor/distance'
sensor.nodeX, sensor.nodeY = 0, -600
lfo.outputConnectors[0].connect(sensor)

# Both, up to OSCAR: the rack's meters follow them.
merge = demo.create(mergeCHOP, 'readings')
merge.nodeX, merge.nodeY = 200, -500
audio.outputConnectors[0].connect(merge.inputConnectors[0])
sensor.outputConnectors[0].connect(merge.inputConnectors[1])
oscout = demo.create(oscoutCHOP, 'oscout')
oscout.par.netaddress = OSCAR_IP
oscout.par.port = OSCAR_PORT
oscout.nodeX, oscout.nodeY = 400, -500
merge.outputConnectors[0].connect(oscout)

print('OSCAR demo built in', demo.path, '- listening on 10000, sending readings to', OSCAR_IP, OSCAR_PORT)
