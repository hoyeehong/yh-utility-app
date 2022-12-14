import { useState } from 'react';

function Header({ title }) {
  return <h1>{title ? title : 'Default title'}</h1>;
}

export default function HomePage() {
  
  const [currentMonth, setCurrentMonth] = useState('')
  const [lastMonth, setLastMonth] = useState('')
  const electricitySubTotal = currentMonth-lastMonth
  const electricityTotal = electricitySubTotal*0.2974

  const [waterCurrentMonth, setWaterCurrentMonth] = useState('')
  const [waterLastMonth, setWaterLastMonth] = useState('')
  const waterSubTotal = waterCurrentMonth-waterLastMonth
  const waterTotal1 = waterSubTotal*1.21
  const waterTotal2 = waterSubTotal*0.92
  const waterTotal = waterTotal1*0.5
  const waterFinalTotal = waterTotal1+waterTotal2+waterTotal

  const combinedTotal = (electricityTotal+waterFinalTotal+3.86)*1.07
  const combinedFinalTotal = combinedTotal+0.5

  async function handleSubmit(e) {
    e.preventDefault()
    setStatus('submitting')
    try {
      //await submitForm(currentMonth)
      setStatus('success')
    } catch (err) {
      setStatus('typing')
      setError(err)
    }
  }

  function handleCurrentMonth(e) {
    setCurrentMonth(e.target.value)
  }
  function handleLastMonth(e) {
    setLastMonth(e.target.value)
  }

  function handleWaterCurrentMonth(e) {
    setWaterCurrentMonth(e.target.value)
  }
  function handleWaterLastMonth(e) {
    setWaterLastMonth(e.target.value)
  }

  return (
    <div>
      <Header title="Utility Demo App" />

      <form onSubmit={handleSubmit}>

      <label>
        <h3>Electricity</h3>
        <input
          placeholder="Current month"
          value={currentMonth}
          onChange={handleCurrentMonth}
        />
        {' '}-{' '}
        <input
          placeholder="Last month"
          value={lastMonth}
          onChange={handleLastMonth}
        />
        {' '}={' '}
        <input value={electricitySubTotal} />
      </label><br></br>

      <label>
        <input value={electricitySubTotal} />{' '}x{' '}<input value="0.2974" />{' '}={' '}<input value={electricityTotal} />
      </label>

      <label>
        <h3>Water</h3>
        <input
          placeholder="Current month"
          value={waterCurrentMonth}
          onChange={handleWaterCurrentMonth}
        />
        {' '}-{' '}
        <input
          placeholder="Last month"
          value={waterLastMonth}
          onChange={handleWaterLastMonth}
        />
        {' '}={' '}
        <input value={waterSubTotal} />
      </label><br></br>

      <label>
        <input value={waterSubTotal} />{' '}x{' '}<input value="1.21" />{' '}={' '}<input value={waterTotal1} />
      </label><br></br>

      <label>
        <input value={waterSubTotal} />{' '}x{' '}<input value="0.92" />{' '}={' '}<input value={waterTotal2} />
      </label><br></br>

      <label>
        <input value={waterTotal1} />{' '}x{' '}<input value="0.5" />{' '}={' '}<input value={waterTotal} />
      </label><br></br>

      <label>
        <input value={waterTotal1}/>{' '}+{' '}<input value={waterTotal2}/>{' '}+{' '}<input value={waterTotal}/>{' '}={' '}<input value={waterFinalTotal}/>
      </label><br></br>

      <label>
        <h3>Subtotal</h3>
        <label>
          (<input value={electricityTotal}/>{' '}+{' '}<input value={waterFinalTotal}/>{' '}+{' '}<input value="3.86"/>){' '}x{' '}<input value="1.07"/>
          {' '}={' '}<input value={combinedFinalTotal.toFixed(2)}/>
        </label><br></br>
      </label>

      </form>
      

      {/* <ul>
        {names.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
      <button onClick={handleClick}>Like ({likes})</button> */}
    </div>
  )

  function submitForm(currentMonth) {
    // Pretend it's hitting the network.
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        let shouldError = answer.toLowerCase() !== 'lima'
        if (shouldError) {
          reject(new Error('Good guess but a wrong answer. Try again!'));
        } else {
          resolve();
        }
      }, 1500);
    })
  }
  
}
