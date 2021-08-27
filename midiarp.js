const midi = require('midi');
const output = new midi.output();
const input = new midi.input();

const State = {
    Blank: 'Blank',
    Note: 'Note',
    Gate: 'Gate',
    GateClosed: 'GateClosed',
    ArpNote: 'ArpNote',
    ArpGate: 'ArpGate',
    ArpGateClosed: 'ArpGateClosed',
    Stop: 'Stop'
};

const MSG_SYSTEM = 15
const PITCH_BEND = 14
const MSG_CHAN_AFTERTOUCH = 13
const MSG_PROG_CHANGE = 12
const MSG_CC = 11
const MSG_POLY_AFTERTOUCH = 10
const MSG_NOTE_ON = 9
const MSG_NOTE_OFF = 8

function byteToNibbles(byte) {
    const high = byte & 0xf;
    const low = byte >> 4;
    return [low, high];
}

/*
for (var i = 0; i < output.getPortCount(); ++i) {
    console.log('Port ' + i + ' name: ' + output.getPortName(i));
}
*/

/*
 
A whimsical thought If an 'algorithm' is a JS file in a sub folder that is a function that takes a root note and returns an array of notes then there can be one CC from 0 to 127 that specifies which file to use.
This has it's limitations but the idea was fun for me. 
The algorithm could, I suppose take a note and a different CC (or list of them) to do things to the algo. That may work (gaps and params and things). 
Then each array item could have two values: a note (or null) and a gate length in ticks. So each one is like a little sequence. 
So the pattern remains fixed until a note or CC is changed. LXR-02 can't send CC, but so be it for now. 
There could then be a CC for 'stop' and use of the notes (once vs looped, up, down, up/down, random etc).

 */

const MINOR = [3,7,12,15,19,24,27,31,27,24,19,15,12,7,3];
//const MINOR = [3,7,12,15,19,24,27,31];
const MAJOR = [4,7,12,16,19,24,28,31];
//const MINOR = [3,7,null,15,19,null,27,31,27,null,19,15,null,7,3];
//const MINOR = [3,7,12,15,null,24,27,31,27,24,null,15,12,7,3];

let inChannel = 12;
let outChannel = 8;
let lastNote = null;
let firstNote = null;
let lastVelocity = null;
let ticks = 0;
let gateTicks = 12; // 6= 1/64th 12 = 1/32
let arpGateDivision = 1; // 0.5 1/16th 2 = 1/64ths etc.
let arps = 3;
let loopArp = false;
let currentArps = 0;
let state = State.Blank;
let oldState = State.Blank;

let bpmTicks = 0;
let bpmPrevious = 0;
let bpm = 0;

console.log('input:',input.getPortName(0));
console.log('output:',output.getPortName(1));

input.openPort(0);
input.ignoreTypes(true, false, true)
output.openPort(1);

function play(note, velocity, channel){
    output.sendMessage([0x90 + (channel-1),note,velocity]);    
}

function off(note, velocity, channel){
    output.sendMessage([0x80 + (channel-1),note,velocity]);    
}

/* Randomize array in-place using Durstenfeld shuffle algorithm */
function shuffleArray(array) {
    for (var i = array.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = array[i];
        array[i] = array[j];
        array[j] = temp;
    }
    return array;
}

function selectArpNote(root,notesArray,number){
    if(notesArray[number]) return root + notesArray[number];
    else return null;
}

function selectRandomArpNote(root,notesArray,number){
    return selectArpNote(root,shuffleArray(notesArray),number);
}

function bpmCalc(){
    if(bpmPrevious>0){
        bpm = ((bpmTicks - bpmPrevious) * 2.5)*4;
    }
    bpmPrevious = bpmTicks;
}

setInterval(bpmCalc,250);//every 1/4 second

let SELECTEDNOTES = MINOR;
let NOTES = SELECTEDNOTES;
let algo = selectArpNote;//selectRandomArpNote;

function setArpegioSteps(steps){
    arps = steps;
    if(arps >NOTES.length) arps = NOTES.length-1;
}

function handleCC(cc,value){
    console.log('YEY CC',cc,value);  
    if(cc===1){
        loopArp = !(value===0);
    } else if (cc===2) {
        setArpegioSteps(value);
    } else if (cc===3) {
        if (value <=6 ) arpGateDivision = value;
        else if (value === 7) arpGateDivision = 0.75;
        else if (value === 8) arpGateDivision = 0.5;
        else if (value === 9) arpGateDivision = 0.25;
        else if (value === 10) arpGateDivision = 0.125;
    } else if (cc===4) {
        gateTicks = value;
    }
}

setArpegioSteps(arps);//initial value clamp to selected notes at start.

input.on('message',(deltaTime,message)=>{    
    let msg = message[0];
    let nib = byteToNibbles(msg);
    let cmd = nib[0];
    let inChan = nib[1];
    let noteChannel = inChan+1;
    let note = message[1];
    let velocity = message[2];    
    if (cmd === MSG_SYSTEM && inChan===8) {
        ticks++;
        bpmTicks++;
    } // clock

    oldState = state;

    if (msg === 252) state = State.Stop; // change to cmd 15 inChan 12?
    else if (cmd === MSG_CC && noteChannel === inChannel) handleCC(note,velocity);
    else if (note && cmd === MSG_NOTE_ON && noteChannel === inChannel) {
        off(note,velocity,outChannel);
        off(lastNote,lastVelocity,outChannel);//This is the reset if it's arpegiating already.
        state = State.Note;
    } 
    else if (oldState === State.Note || oldState === State.Gate) state = State.Gate;
    else if (oldState === State.GateClosed) state = State.ArpNote;
    else if (oldState === State.ArpNote || oldState === State.ArpGate) state = State.ArpGate;
    else if (oldState === State.ArpGateClosed) {
        if (currentArps>=arps-1) {
            currentArps=0;
            state = loopArp?State.GateClosed:State.Blank;
        } else {
            currentArps++;
            state = State.ArpNote;
        }
    }
    else state = State.Blank;

    if(state !== State.Blank && state !== State.ArpGate && state !== State.Gate){
        console.log(`St:${state}`,`Cmd:${cmd}`, `Ch:${inChan+1}`,` N:${note ? note : lastNote}`,
        ` V:${velocity ? velocity : lastVelocity}`,` T:${ticks}`,` A:${currentArps}`, `Bp:${bpm}`);
    }

    if(state === State.Note)
    {
        ticks = 0;
        currentArps = 0;
        lastNote = note;
        firstNote = note;
        lastVelocity = velocity;
        play(note,velocity,outChannel);
    } else if (state === State.Gate) {
        if (ticks >= gateTicks) {
            off(lastNote,lastVelocity,outChannel);
            state = State.GateClosed;
        }
    } else if (state === State.ArpNote) {
        ticks = 0;
        let arpNote = algo(firstNote,NOTES,currentArps);
        if(arpNote) {
            lastNote = arpNote;
            play(arpNote,lastVelocity,outChannel);
        }
    } else if (state === State.ArpGate){
        if (ticks >= (gateTicks/arpGateDivision)) {
            off(lastNote,lastVelocity,outChannel);
            state = State.ArpGateClosed;
        }
    } else if (state === State.Stop) {
        ticks = 0;
        off(note,velocity,outChannel);
        off(lastNote,lastVelocity,outChannel);
    }

});

    //output.closePort();
    //input.closePort();
    //console.log('Is open', output.isPortOpen());
