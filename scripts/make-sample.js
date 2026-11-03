#!/usr/bin/env node
'use strict';
// Creates a small solution (new project + Add Class) in the folder given, for CI to build with MSBuild.
// Usage: node scripts/make-sample.js <folder>
const fs = require('fs');
const path = require('path');
const ws = require('../extension/lib/workspace');

const out = path.resolve(process.argv[2] || 'sample');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
ws.createProject({ location: out, name: 'Sample' });
const dir = path.join(out, 'Sample');
const project = ws.loadSolution(dir).projects[0];
ws.addClass(project, 'Board');
fs.writeFileSync(path.join(project.dir, 'Board.cpp'),
  '#include "Board.h"\n\nBoard::Board() {}\nBoard::~Board() {}\nint Board::size() const { return 10; }\n');
fs.writeFileSync(path.join(project.dir, 'Board.h'),
  '#pragma once\n\nclass Board\n{\npublic:\n    Board();\n    ~Board();\n    int size() const;\n};\n');
fs.writeFileSync(path.join(project.dir, 'Sample.cpp'),
  '#include <iostream>\n#include "Board.h"\n\nint main()\n{\n    Board board;\n    std::cout << "board " << board.size() << "\\n";\n}\n');
console.log('Sample solution written to ' + dir);
