console.log("Hello, World!");
console.log("This is a test file.");

add(5, 10);
v2();

async function add(a, b) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log(`Adding ${a} and ${b}`);
    
    return a + b;
}

function v2() {
    while (true) {
        // console.log("This is an infinite loop");
        

    }
}